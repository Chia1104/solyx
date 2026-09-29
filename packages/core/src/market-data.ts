import type { Candle, Interval } from "./candles.ts";
import type { Market, SymbolRef } from "./market.ts";

export interface CandleRequest {
  symbol: SymbolRef;
  interval: Interval;
  /** Exchange-local dates (`YYYY-MM-DD`), inclusive. */
  from: string;
  to: string;
}

/** One implementation per data provider (`@solyx/market-data/*`); it runs only in the main process. */
export interface MarketDataProvider {
  readonly id: string;
  readonly markets: readonly Market[];
  /** Returns bars in strictly ascending time, including today's session when `to` reaches today; a symbol the provider does not list has none. */
  getCandles(request: CandleRequest): Promise<Candle[]>;
}
