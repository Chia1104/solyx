import type { Candle, Interval } from "./candles.ts";
import type { Market, SymbolRef } from "./market.ts";

export interface CandleRequest {
  symbol: SymbolRef;
  interval: Interval;
  /** Exchange-local dates (`YYYY-MM-DD`), inclusive. */
  from: string;
  to: string;
}

/** How the exchange names a listing. */
export interface Listing {
  /** The exchange's own name, such as 台積電. */
  name: string;
  englishName: string | null;
}

/** One implementation per data provider (`@solyx/market-data/*`); it runs only in the main process. */
export interface MarketDataProvider {
  readonly id: string;
  readonly markets: readonly Market[];
  /** Returns bars in strictly ascending time, including today's session when `to` reaches today; a symbol the provider does not list has none. */
  getCandles(request: CandleRequest): Promise<Candle[]>;
  /** `null` for a symbol the provider does not list. */
  getListing(symbol: SymbolRef): Promise<Listing | null>;
}

/** Bars and names in every market, from the source the user picked for it. */
export interface MarketData {
  /** Bars over the interval's lookback, oldest first; rejects while no source covers the market. */
  candles(symbol: SymbolRef, interval: Interval): Promise<Candle[]>;
  /** `null` when no source covers the market or the source does not list the symbol. */
  listing(symbol: SymbolRef): Promise<Listing | null>;
}

export interface MinuteListener {
  /** The session's minute bars so far: sent when watching starts and after every reconnect, since pushes during an outage are lost. */
  onSession(minutes: Candle[]): void;
  /** A minute bar as trades update it; the last push for a minute is its final state. */
  onMinute(minute: Candle): void;
}

/** Live minute bars from a provider's stream; one implementation per provider, main process only. */
export interface MarketDataStream {
  readonly id: string;
  readonly markets: readonly Market[];
  /** Starts watching `symbol`; returns a function that stops, or `undefined` when the stream cannot take another symbol. */
  watchMinutes(
    symbol: SymbolRef,
    listener: MinuteListener
  ): (() => void) | undefined;
  close(): void;
}

/** A plan a provider sells; `id` is the provider's own name for it. */
export interface MarketDataPlan<Id extends string = string> {
  id: Id;
  /** Symbols its live stream can watch at once. */
  streamSymbols: number;
  /** REST requests per minute for today's session and for history. */
  requestsPerMinute: { intraday: number; historical: number };
}
