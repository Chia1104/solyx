import type { Candle, Interval } from "@solyx/core/candles";
import type { Market, SymbolRef } from "@solyx/core/market";
import type { Listing } from "@solyx/core/market-data";
import type { Session } from "@solyx/core/session";

/** A watched symbol's forming bar in one interval; it replaces the bar with the same time. */
export interface LiveCandle {
  symbol: SymbolRef;
  interval: Interval;
  candle: Candle;
}

export interface MarketApi {
  sessions(): Promise<Record<Market, Session>>;
  /** `null` when no source covers the market or the source does not list the symbol. */
  listing(symbol: SymbolRef): Promise<Listing | null>;
  /** Recent bars, oldest first; the lookback depends on the interval. */
  candles(symbol: SymbolRef, interval: Interval): Promise<Candle[]>;
  /** Starts pushing today's bars of `symbol` in `interval`; false when no live stream covers it. */
  watchCandles(symbol: SymbolRef, interval: Interval): Promise<boolean>;
  unwatchCandles(symbol: SymbolRef, interval: Interval): Promise<void>;
}

/** Pushes from the main process; each subscription returns a function that stops listening. */
export interface MarketEvents {
  onLiveCandles(listener: (updates: LiveCandle[]) => void): () => void;
  /** Where some market's bars come from changed, by the settings page or a hand edit: load and watch again. */
  onSourcesChanged(listener: () => void): () => void;
}

export const marketChannels = {
  sessions: "market:sessions",
  listing: "market:listing",
  candles: "market:candles",
  watchCandles: "market:watch-candles",
  unwatchCandles: "market:unwatch-candles",
} as const satisfies Record<keyof MarketApi, string>;

export const marketEvents = {
  onLiveCandles: "market:live-candles",
  onSourcesChanged: "market:sources-changed",
} as const satisfies Record<keyof MarketEvents, string>;
