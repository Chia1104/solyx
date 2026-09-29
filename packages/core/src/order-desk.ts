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
  error?: string;
}

export interface OrderDeskOptions {
  broker: BrokerAdapter;
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
  readonly #proposals = new Map<string, TradeProposal>();

  constructor(options: OrderDeskOptions) {
    this.#options = options;
  }

  list(): TradeProposal[] {
    return [...this.#proposals.values()].map((p) => structuredClone(p));
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

    this.#proposals.set(proposal.id, proposal);

    return structuredClone(proposal);
  }

  async confirm(id: string): Promise<TradeProposal> {
    const proposal = this.#pending(id);
    // Claim it before any await so a double click cannot submit twice.
    proposal.status = ProposalStatus.Submitting;

    try {
      // Prices and sessions move between propose and confirm; check again.
      proposal.violations = await this.#check(proposal.order);

      if (proposal.violations.length > 0) {
        proposal.status = ProposalStatus.Rejected;
      } else {
        const { orderId } = await this.#options.broker.placeOrder(
          proposal.order
        );

        proposal.status = ProposalStatus.Submitted;
        proposal.brokerOrderId = orderId;
      }
    } catch (error) {
      // Terminal on purpose: the broker may have accepted the order anyway, so never auto-retry.
      proposal.status = ProposalStatus.Failed;
      proposal.error = error instanceof Error ? error.message : String(error);
    }

    return structuredClone(proposal);
  }

  dismiss(id: string): TradeProposal {
    const proposal = this.#pending(id);
    proposal.status = ProposalStatus.Dismissed;

    return structuredClone(proposal);
  }

  async #check(order: OrderRequest): Promise<RiskViolation[]> {
    return checkOrder(
      order,
      this.#options.limits,
      await this.#options.riskContext(order)
    );
  }

  #pending(id: string): TradeProposal {
    const proposal = this.#proposals.get(id);

    if (!proposal) throw new Error(`Proposal ${id} not found`);

    if (proposal.status !== ProposalStatus.AwaitingConfirmation) {
      throw new Error(
        `Proposal ${id} is ${proposal.status} and can no longer change`
      );
    }

    return proposal;
  }
}
