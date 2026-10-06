import type { SymbolRef } from "@solyx/core/market";

export interface WatchlistApi {
  /** Watched listings in the user's order. */
  list(): Promise<SymbolRef[]>;
  add(symbol: SymbolRef): Promise<void>;
  remove(symbol: SymbolRef): Promise<void>;
  /** Moves a watched listing to `index` among the others. */
  move(symbol: SymbolRef, index: number): Promise<void>;
}

export const watchlistChannels = {
  list: "watchlist:list",
  add: "watchlist:add",
  remove: "watchlist:remove",
  move: "watchlist:move",
} as const satisfies Record<keyof WatchlistApi, string>;
