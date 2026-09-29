import type { BrokerMode } from "@solyx/core/broker";
import type { Market } from "@solyx/core/market";
import type { AccountSnapshot, OrderRequest } from "@solyx/core/order";
import type { TradeProposal } from "@solyx/core/order-desk";
import type { Session } from "@solyx/core/session";

export interface Overview {
  brokerMode: BrokerMode;
  sessions: Record<Market, Session>;
  account: AccountSnapshot;
  proposals: TradeProposal[];
}

/** Everything the renderer can ask of the main process, exposed as `window.solyx`. */
export interface SolyxApi {
  getOverview(): Promise<Overview>;
  proposeOrder(order: OrderRequest, rationale: string): Promise<TradeProposal>;
  confirmProposal(id: string): Promise<TradeProposal>;
  dismissProposal(id: string): Promise<TradeProposal>;
}

export const IPC_CHANNELS = {
  getOverview: "solyx:get-overview",
  proposeOrder: "solyx:propose-order",
  confirmProposal: "solyx:confirm-proposal",
  dismissProposal: "solyx:dismiss-proposal",
} as const satisfies Record<keyof SolyxApi, string>;
