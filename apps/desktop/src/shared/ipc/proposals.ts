import type { OrderRequest } from "@solyx/core/order";
import type { TradeProposal } from "@solyx/core/order-desk";

export interface ProposalsApi {
  list(): Promise<TradeProposal[]>;
  propose(order: OrderRequest, rationale: string): Promise<TradeProposal>;
  confirm(id: string): Promise<TradeProposal>;
  dismiss(id: string): Promise<TradeProposal>;
}

export const proposalsChannels = {
  list: "proposals:list",
  propose: "proposals:propose",
  confirm: "proposals:confirm",
  dismiss: "proposals:dismiss",
} as const satisfies Record<keyof ProposalsApi, string>;
