import type { BrokerAdapter } from "./broker.ts";
import type { OrderRequest } from "./order.ts";
import { checkOrder } from "./risk.ts";
import type { RiskContext, RiskLimits, RiskViolation } from "./risk.ts";

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
  broker: BrokerAdapter;
  store: ProposalStore;
  limits: RiskLimits;
  riskContext: (order: OrderRequest) => Promise<RiskContext>;
  now?: () => number;
  createId?: () => string;
}

/**
 * The only road from an idea to a real order: propose → risk check → human confirm → broker.
 * Agents get `propose` and nothing else; `confirm` must stay behind a user action in the UI.
 */
export class OrderDesk {
  readonly #options: OrderDeskOptions;

  constructor(options: OrderDeskOptions) {
    this.#options = options;

    // The app exited mid-submission, so the broker may hold the order: fail it, never resubmit.
    for (const proposal of options.store.list()) {
      if (proposal.status !== ProposalStatus.Submitting) continue;

      options.store.update({
        ...proposal,
        status: ProposalStatus.Failed,
        failure: { code: SubmissionFailureCode.Interrupted },
      });
    }
  }

  list(): TradeProposal[] {
    return this.#options.store.list();
  }

  async propose(input: {
    order: OrderRequest;
    source: ProposalSource;
    rationale: string;
  }): Promise<TradeProposal> {
    const { now = Date.now, createId = () => crypto.randomUUID() } =
      this.#options;

    const violations = await this.#check(input.order);

    const proposal: TradeProposal = {
      id: createId(),
      ...input,
      createdAt: now(),
      status:
        violations.length > 0
          ? ProposalStatus.Rejected
          : ProposalStatus.AwaitingConfirmation,
      violations,
    };

    this.#options.store.add(proposal);

    return proposal;
  }

  async confirm(id: string): Promise<TradeProposal> {
    const { broker, store } = this.#options;

    // Claim it before any await so a double click cannot submit twice.
    let proposal: TradeProposal = {
      ...this.#pending(id),
      status: ProposalStatus.Submitting,
    };

    store.update(proposal);

    try {
      // Prices and sessions move between propose and confirm; check again.
      const violations = await this.#check(proposal.order);

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
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }

    store.update(proposal);

    return proposal;
  }

  dismiss(id: string): TradeProposal {
    const proposal: TradeProposal = {
      ...this.#pending(id),
      status: ProposalStatus.Dismissed,
    };

    this.#options.store.update(proposal);

    return proposal;
  }

  async #check(order: OrderRequest): Promise<RiskViolation[]> {
    return checkOrder(
      order,
      this.#options.limits,
      await this.#options.riskContext(order)
    );
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
