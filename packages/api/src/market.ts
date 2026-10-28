import type { Candle, Interval } from "@solyx/core/candles";
import type { Market, SymbolRef } from "@solyx/core/market";
import type { RotationReading } from "@solyx/core/rotation";
import type { TwSector } from "@solyx/core/sectors";

/** Bars with the listing and interval they belong to, which stay attached while they stand in for another query. */
export interface CandleSet {
  symbol: SymbolRef;
  interval: Interval;
  candles: Candle[];
}

/** A listing a search found, named as its market knows it. */
export interface ListingMatch {
  symbol: SymbolRef;
  name: string;
  /** `null` where the source gives none, as Taiwan's exchanges do. */
  englishName: string | null;
}

/** What a search found, best first, and the markets it asked whose listings could not be read, whose matches are missing. */
export interface ListingSearch {
  matches: ListingMatch[];
  unread: Market[];
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
