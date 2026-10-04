import type { OrderRequest } from "@solyx/core/order";
import type { TradeProposal } from "@solyx/core/order-desk";

export interface ProposalsApi {
  list(): Promise<TradeProposal[]>;
  propose(order: OrderRequest, rationale: string): Promise<TradeProposal>;
  confirm(id: string): Promise<TradeProposal>;
  dismiss(id: string): Promise<TradeProposal>;
}

/** Pushes from the main process; each subscription returns a function that stops listening. */
export interface ProposalsEvents {
  /** A proposal was made or changed, by any window or the agent; the account may have changed with it. */
  onChanged(listener: () => void): () => void;
}

export const proposalsChannels = {
  list: "proposals:list",
  propose: "proposals:propose",
  confirm: "proposals:confirm",
  dismiss: "proposals:dismiss",
} as const satisfies Record<keyof ProposalsApi, string>;

export const proposalsEvents = {
  onChanged: "proposals:changed",
} as const satisfies Record<keyof ProposalsEvents, string>;
