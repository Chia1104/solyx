import type { Candle, Interval } from "@solyx/core/candles";
import type { Market, SymbolRef } from "@solyx/core/market";
import type { Listing, Quote } from "@solyx/core/market-data";
import type { SessionQuote } from "@solyx/core/quote";
import type { SectorIndex } from "@solyx/core/sectors";
import type { Session } from "@solyx/core/session";

/** A watched symbol's forming bar in one interval; it replaces the bar with the same time. */
export interface LiveCandle {
  symbol: SymbolRef;
  interval: Interval;
  candle: Candle;
}

/** A sector index and its session so far; `null` until it has traded. */
export interface SectorQuote extends SectorIndex {
  quote: Quote | null;
}

export interface MarketApi {
  sessions(): Promise<Record<Market, Session>>;
  /** `null` when no source covers the market or the source does not list the symbol. */
  listing(symbol: SymbolRef): Promise<Listing | null>;
  /** Recent bars, oldest first; the lookback depends on the interval. */
  candles(symbol: SymbolRef, interval: Interval): Promise<Candle[]>;
  /** The page of history before the bar opening at `before`, oldest first; empty once the source has nothing older. */
  olderCandles(
    symbol: SymbolRef,
    interval: Interval,
    before: number
  ): Promise<Candle[]>;
  /**
   * The newest session's five-minute line against the close before it; `null` when no source
   * covers the market or the source has no bars for the symbol. It takes no stream slot.
   */
  quote(symbol: SymbolRef): Promise<SessionQuote | null>;
  /** Every Taiwan sector index's session so far, one request each; `null` when no source covers Taiwan. */
  sectors(): Promise<SectorQuote[] | null>;
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
  olderCandles: "market:older-candles",
  quote: "market:quote",
  sectors: "market:sectors",
  watchCandles: "market:watch-candles",
  unwatchCandles: "market:unwatch-candles",
} as const satisfies Record<keyof MarketApi, string>;

export const marketEvents = {
  onLiveCandles: "market:live-candles",
  onSourcesChanged: "market:sources-changed",
} as const satisfies Record<keyof MarketEvents, string>;
