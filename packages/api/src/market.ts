import type { Candle, Interval } from "@solyx/core/candles";
import type { SymbolRef } from "@solyx/core/market";
import type { RotationReading } from "@solyx/core/rotation";
import type { TwSector } from "@solyx/core/sectors";

/** Bars with the listing and interval they belong to, which stay attached while they stand in for another query. */
export interface CandleSet {
  symbol: SymbolRef;
  interval: Interval;
  candles: Candle[];
}

/** One listing on the rotation graph: against its market's index, and against its own sector's index where it has one. */
export interface ListingRotationView {
  index: { name: string; readings: RotationReading[] };
  /** `null` for a listing outside the Taiwan Stock Exchange's industries that have an index. */
  sector: {
    sector: TwSector;
    symbol: string;
    readings: RotationReading[];
  } | null;
}
