import type { ListingFlows, MarketFlows } from "@solyx/core/flows";
import type { Market, SymbolRef } from "@solyx/core/market";

export interface FlowsApi {
  /** Who traded a listing over the last two months of sessions, oldest first. */
  listing(symbol: SymbolRef): Promise<ListingFlows>;
  /** Who traded the whole market and its index future over the same sessions. */
  market(market: Market): Promise<MarketFlows>;
}

export const flowsChannels = {
  listing: "flows:listing",
  market: "flows:market",
} as const satisfies Record<keyof FlowsApi, string>;
