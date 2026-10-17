import type { Candle, Interval } from "@solyx/core/candles";
import type { SymbolRef } from "@solyx/core/market";

/** Bars with the listing and interval they belong to, which stay attached while they stand in for another query. */
export interface CandleSet {
  symbol: SymbolRef;
  interval: Interval;
  candles: Candle[];
}
