import type { Candle, Interval } from "@solyx/core/candles";
import type { Market, SymbolRef } from "@solyx/core/market";
import type { Session } from "@solyx/core/session";

export interface MarketApi {
  sessions(): Promise<Record<Market, Session>>;
  /** Recent bars, oldest first; the lookback depends on the interval. */
  candles(symbol: SymbolRef, interval: Interval): Promise<Candle[]>;
}

export const marketChannels = {
  sessions: "market:sessions",
  candles: "market:candles",
} as const satisfies Record<keyof MarketApi, string>;
