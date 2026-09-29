import type { SymbolRef } from "@solyx/core/market";

export interface WatchlistApi {
  /** Watched listings in the order they were added. */
  list(): Promise<SymbolRef[]>;
  add(symbol: SymbolRef): Promise<void>;
  remove(symbol: SymbolRef): Promise<void>;
}

export const watchlistChannels = {
  list: "watchlist:list",
  add: "watchlist:add",
  remove: "watchlist:remove",
} as const satisfies Record<keyof WatchlistApi, string>;
