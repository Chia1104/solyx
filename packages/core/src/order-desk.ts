import { errorMessage } from "@solyx/utils/error";

import type { BrokerAdapter, BrokerMode } from "./broker.ts";
import type { Forecast } from "./forecast.ts";
import type { Market, SymbolRef } from "./market.ts";
import type { AccountSnapshot, OrderRequest } from "./order.ts";
import type { Report } from "./report.ts";
import { checkOrder, sessionBand } from "./risk.ts";
import type { PriceLimits, RiskLimits, RiskViolation } from "./risk.ts";
import { getSession, weekdays } from "./session.ts";
import type { TradingDays } from "./session.ts";

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

/** What research held of a listing as a proposal for it was made, kept as it stood then. */
export interface ProposalBasis {
  /** The report in force; `null` while the listing had none. */
  report: Pick<Report, "revision" | "revisedAt" | "stance"> | null;
  /** The newest forecast made under that report; `null` while it had none. */
  forecast: Pick<Forecast, "id" | "createdAt" | "direction" | "horizon"> | null;
}

export interface TradeProposal {
  id: string;
  order: OrderRequest;
  source: ProposalSource;
  /** Why this trade: the agent's argument or the user's note. Kept for the review log. */
  rationale: string;
  /** The research it was made under; `null` where the desk had none to read. */
  basis: ProposalBasis | null;
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
  /**
   * The days a market trades, so an order on a holiday is checked against a closed session. It
   * must answer even while the exchange's days cannot be read.
   * @default every weekday trades
   */
  tradingDays?: (market: Market) => Promise<TradingDays>;
  /**
   * A listing's price limits as its exchange last set them, which a limit price is checked against
   * and a market order sized by. It must answer even while the exchange's lists cannot be read.
   * @default none are known: no limit price is checked against a band, and every market order is refused
   */
  priceLimits?: (symbol: SymbolRef) => Promise<PriceLimits | null>;
  /**
   * The store was put back from a backup. A proposal that waits in it may have been confirmed
   * since the backup was made, so the desk dismisses each as it opens.
   * @default false
   */
  restored?: boolean;
  /**
   * What research holds of a listing, which the desk keeps with each proposal for it, so neither
   * the agent nor the user picks what a proposal is reviewed against.
   * @default none is read, and proposals keep no basis
   */
  basis?: (symbol: SymbolRef) => ProposalBasis;
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

    // Nobody shows proposals before the desk exists, so these changes are told to no one.
    for (const proposal of options.store.list()) {
      // The app exited mid-submission, so the broker may hold the order: fail it, never resubmit.
      if (proposal.status === ProposalStatus.Submitting) {
        options.store.update({
          ...proposal,
          status: ProposalStatus.Failed,
          failure: { code: SubmissionFailureCode.Interrupted },
        });
      } else if (
        options.restored &&
        proposal.status === ProposalStatus.AwaitingConfirmation
      ) {
        options.store.update({
          ...proposal,
          status: ProposalStatus.Dismissed,
        });
      }
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
      basis,
      now = Date.now,
      createId = () => crypto.randomUUID(),
    } = this.#options;

    const made = id === undefined ? undefined : store.get(id);

    if (made) return made;

    const violations = await this.check(input.order);

    const proposal: TradeProposal = {
      id: id ?? createId(),
      ...input,
      basis: basis?.(input.order.instrument) ?? null,
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

  /** The risk checks alone, so an order can be tried before it is proposed. */
  async check(order: OrderRequest): Promise<RiskViolation[]> {
    const {
      broker,
      limits,
      tradingDays,
      priceLimits,
      now = Date.now,
    } = this.#options;

    const { instrument } = order;
    const at = new Date(now());
    const trades = (await tradingDays?.(instrument.market)) ?? weekdays;

    const [account, listed] = await Promise.all([
      broker.getAccount(),
      priceLimits?.(instrument) ?? null,
    ]);

    return checkOrder(order, limits, {
      session: getSession(instrument.market, at, trades),
      markets: broker.markets,
      account,
      priceBand: sessionBand(listed, instrument.market, at, trades),
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
