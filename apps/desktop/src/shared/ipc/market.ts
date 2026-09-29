import type { Candle, Interval } from "@solyx/core/candles";
import type { Market, SymbolRef } from "@solyx/core/market";
import type { Session } from "@solyx/core/session";

/** A watched symbol's forming bar in one interval; it replaces the bar with the same time. */
export interface LiveCandle {
  symbol: SymbolRef;
  interval: Interval;
  candle: Candle;
}

export interface MarketApi {
  sessions(): Promise<Record<Market, Session>>;
  /** Recent bars, oldest first; the lookback depends on the interval. */
  candles(symbol: SymbolRef, interval: Interval): Promise<Candle[]>;
  /** Starts pushing today's bars of `symbol` in `interval`; false when no live stream covers it. */
  watchCandles(symbol: SymbolRef, interval: Interval): Promise<boolean>;
  unwatchCandles(symbol: SymbolRef, interval: Interval): Promise<void>;
}

/** Pushes from the main process; each subscription returns a function that stops listening. */
export interface MarketEvents {
  onLiveCandles(listener: (updates: LiveCandle[]) => void): () => void;
}

export const marketChannels = {
  sessions: "market:sessions",
  candles: "market:candles",
  watchCandles: "market:watch-candles",
  unwatchCandles: "market:unwatch-candles",
} as const satisfies Record<keyof MarketApi, string>;

export const marketEvents = {
  onLiveCandles: "market:live-candles",
} as const satisfies Record<keyof MarketEvents, string>;
