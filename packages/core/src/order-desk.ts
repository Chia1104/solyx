import { errorMessage } from "@solyx/utils/error";

import type { BrokerAdapter, BrokerMode } from "./broker.ts";
import type { AccountSnapshot, OrderRequest } from "./order.ts";
import { checkOrder } from "./risk.ts";
import type { RiskLimits, RiskViolation } from "./risk.ts";
import { getSession } from "./session.ts";

export const ProposalSource = {
  Agent: "agent",
  User: "user",
} as const;

export type ProposalSource =
  (typeof ProposalSource)[keyof typeof ProposalSource];

export const ProposalStatus = {
  AwaitingConfirmation: "awaiting-confirmation",
  Submitting: "submitting",
  Submitted: "submitted",
  Rejected: "rejected",
  Dismissed: "dismissed",
  Failed: "failed",
} as const;

export type ProposalStatus =
  (typeof ProposalStatus)[keyof typeof ProposalStatus];

export const SubmissionFailureCode = {
  /** Checking or placing the order threw. */
  Error: "error",
  /** The app exited before the broker answered. */
  Interrupted: "interrupted",
} as const;

export type SubmissionFailure =
  | { code: typeof SubmissionFailureCode.Error; message: string }
  | { code: typeof SubmissionFailureCode.Interrupted };

export interface TradeProposal {
  id: string;
  order: OrderRequest;
  source: ProposalSource;
  /** Why this trade: the agent's argument or the user's note. Kept for the review log. */
  rationale: string;
  createdAt: number;
  status: ProposalStatus;
  violations: RiskViolation[];
  brokerOrderId?: string;
  failure?: SubmissionFailure;
}

/**
 * Where the desk keeps proposals across restarts. Synchronous so the desk can claim a
 * proposal before its first await, which is what stops a double click submitting twice.
 */
export interface ProposalStore {
  /** Oldest first. */
  list(): TradeProposal[];
  get(id: string): TradeProposal | undefined;
  add(proposal: TradeProposal): void;
  /** Replaces the stored proposal with the same id. */
  update(proposal: TradeProposal): void;
}

export interface OrderDeskOptions {
  /** The desk is its only holder, so nothing else can reach `placeOrder`. */
  broker: BrokerAdapter;
  store: ProposalStore;
  limits: RiskLimits;
  /** Called after every change to a proposal, so whoever shows them can refresh. */
  onChange?: () => void;
  now?: () => number;
  createId?: () => string;
}

/** The desk as an agent may use it: proposing and reading, never confirming or dismissing. */
export type ProposingDesk = Pick<
  OrderDesk,
  "check" | "propose" | "list" | "account" | "mode"
>;

/**
 * The only road from an idea to a real order: propose → risk check → human confirm → broker.
 * Agents get a `ProposingDesk`; `confirm` must stay behind a user action in the UI.
 */
export class OrderDesk {
  readonly #options: OrderDeskOptions;

  constructor(options: OrderDeskOptions) {
    this.#options = options;

    // The app exited mid-submission, so the broker may hold the order: fail it, never resubmit.
    for (const proposal of options.store.list()) {
      if (proposal.status !== ProposalStatus.Submitting) continue;

      this.#save({
        ...proposal,
        status: ProposalStatus.Failed,
        failure: { code: SubmissionFailureCode.Interrupted },
      });
    }
  }

  list(): TradeProposal[] {
    return this.#options.store.list();
  }

  get mode(): BrokerMode {
    return this.#options.broker.mode;
  }

  account(): Promise<AccountSnapshot> {
    return this.#options.broker.getAccount();
  }

  /**
   * A caller that may run again after a crash passes the same `id` each time, and gets back the
   * proposal already made under it instead of a second one.
   */
  async propose({
    id,
    ...input
  }: {
    id?: string;
    order: OrderRequest;
    source: ProposalSource;
    rationale: string;
  }): Promise<TradeProposal> {
    const {
      store,
      now = Date.now,
      createId = () => crypto.randomUUID(),
    } = this.#options;

    const made = id === undefined ? undefined : store.get(id);

    if (made) return made;

    const violations = await this.check(input.order);

    const proposal: TradeProposal = {
      id: id ?? createId(),
      ...input,
      createdAt: now(),
      status:
        violations.length > 0
          ? ProposalStatus.Rejected
          : ProposalStatus.AwaitingConfirmation,
      violations,
    };

    store.add(proposal);
    this.#options.onChange?.();

    return proposal;
  }

  async confirm(id: string): Promise<TradeProposal> {
    const { broker } = this.#options;

    // Claim it before any await so a double click cannot submit twice.
    let proposal: TradeProposal = {
      ...this.#pending(id),
      status: ProposalStatus.Submitting,
    };

    this.#save(proposal);

    try {
      // Prices and sessions move between propose and confirm; check again.
      const violations = await this.check(proposal.order);

      if (violations.length > 0) {
        proposal = { ...proposal, status: ProposalStatus.Rejected, violations };
      } else {
        const { orderId } = await broker.placeOrder(proposal.order);

        proposal = {
          ...proposal,
          status: ProposalStatus.Submitted,
          violations,
          brokerOrderId: orderId,
        };
      }
    } catch (error) {
      // Terminal on purpose: the broker may have accepted the order anyway, so never auto-retry.
      proposal = {
        ...proposal,
        status: ProposalStatus.Failed,
        failure: {
          code: SubmissionFailureCode.Error,
          message: errorMessage(error),
        },
      };
    }

    this.#save(proposal);

    return proposal;
  }

  dismiss(id: string): TradeProposal {
    const proposal: TradeProposal = {
      ...this.#pending(id),
      status: ProposalStatus.Dismissed,
    };

    this.#save(proposal);

    return proposal;
  }

  /**
   * The risk checks alone, so an order can be tried before it is proposed. There is no quote
   * feed yet, so market orders are rejected for lack of a reference price.
   */
  async check(order: OrderRequest): Promise<RiskViolation[]> {
    const { broker, limits, now = Date.now } = this.#options;

    return checkOrder(order, limits, {
      session: getSession(order.instrument.market, new Date(now())),
      markets: broker.markets,
      account: await broker.getAccount(),
    });
  }

  #save(proposal: TradeProposal) {
    this.#options.store.update(proposal);
    this.#options.onChange?.();
  }

  #pending(id: string): TradeProposal {
    const proposal = this.#options.store.get(id);

    if (!proposal) throw new Error(`Proposal ${id} not found`);

    if (proposal.status !== ProposalStatus.AwaitingConfirmation) {
      throw new Error(
        `Proposal ${id} is ${proposal.status} and can no longer change`
      );
    }

    return proposal;
  }
}
