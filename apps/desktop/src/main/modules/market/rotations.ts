import { Interval, adjustedCandles, lookbackRange } from "@solyx/core/candles";
import type { Candle } from "@solyx/core/candles";
import type { Company } from "@solyx/core/fundamentals";
import { BENCHMARK, Market, exchangeDate } from "@solyx/core/market";
import type { SymbolRef } from "@solyx/core/market";
import { readEveryRotation } from "@solyx/core/rotation";
import type {
  ListingRotation,
  RotationReading,
  SectorRotation,
} from "@solyx/core/rotation";
import { TW_SECTOR_INDICES, sectorOfIndustry } from "@solyx/core/sectors";
import { MINUTE_MS } from "@solyx/utils/date";
import { freshFor, keepFresh } from "@solyx/utils/fresh";
import type { AnswerStores } from "@solyx/utils/fresh";

import type { ListingRotationView } from "#shared/market.ts";

/** The sectors' readings cost a daily-bar request per index, so the overview's graph and the agent share a read this long. */
const ROTATIONS_FRESH_MS = MINUTE_MS;

interface RotationsOptions {
  /** A listing's daily bars from `since` on, through the candle cache; rejects while no source covers its market. */
  candlesSince(symbol: SymbolRef, since: string): Promise<Candle[]>;
  /** The id of the source covering `market`; `null` while none does. */
  sourceId(market: Market): Promise<string | null>;
  /** Which company a Taiwan listing is, for its industry; `null` where the exchange's list has none. */
  company(symbol: SymbolRef): Promise<Company | null>;
  /** Where the sectors' readings are kept between reads. */
  answers: AnswerStores;
  /** @default () => new Date() */
  now?: () => Date;
}

/**
 * Every rotation the app reads, on daily bars through the candle cache: the sectors against the
 * TAIEX, listings against their market's index or any benchmark, each over every interval and
 * period. Listings' bars are adjusted for splits and what went ex; an index's need no adjusting.
 */
export function createRotations({
  candlesSince,
  sourceId,
  company,
  answers,
  now = () => new Date(),
}: RotationsOptions) {
  // Three years of daily bars hold a year of weeks twice over, which the longest weekly period needs.
  const daily = (symbol: SymbolRef) =>
    candlesSince(
      symbol,
      lookbackRange(symbol.market, Interval.OneWeek, now()).from
    );

  const today = (market: Market) => exchangeDate(market, now());

  const readings = (
    symbol: SymbolRef,
    bars: readonly Candle[],
    benchmark: readonly Candle[]
  ) => readEveryRotation(symbol.market, bars, benchmark, today(symbol.market));

  const sectorRotations = keepFresh<string, SectorRotation[]>({
    store: answers("market:rotations"),
    id: (source) => source,
    async ask() {
      const taiex = BENCHMARK[Market.TW].symbol;
      const benchmark = await daily(taiex);

      return Promise.all(
        TW_SECTOR_INDICES.map(async (index) => {
          const symbol = { market: Market.TW, symbol: index.symbol };

          return {
            ...index,
            readings: readings(symbol, await daily(symbol), benchmark),
          };
        })
      );
    },
    fresh: freshFor(ROTATIONS_FRESH_MS),
    now: () => now().getTime(),
  });

  /** A listing's readings against `benchmark`'s bars, on its own bars adjusted. */
  async function against(
    symbol: SymbolRef,
    benchmark: Promise<Candle[]>
  ): Promise<RotationReading[]> {
    const [bars, other] = await Promise.all([daily(symbol), benchmark]);

    return readings(symbol, adjustedCandles(bars), other);
  }

  async function listings(
    symbols: readonly SymbolRef[]
  ): Promise<ListingRotation[]> {
    const benchmarks = new Map<Market, Promise<Candle[]>>();

    const benchmark = (market: Market) => {
      let bars = benchmarks.get(market);

      if (!bars) {
        bars = daily(BENCHMARK[market].symbol);
        benchmarks.set(market, bars);
      }

      return bars;
    };

    return Promise.all(
      symbols.map(async (symbol) => ({
        symbol,
        readings: await against(symbol, benchmark(symbol.market)),
      }))
    );
  }

  return {
    /** Every Taiwan sector index against the TAIEX; `null` when no source covers Taiwan. */
    async sectors(): Promise<SectorRotation[] | null> {
      const source = await sourceId(Market.TW);

      return source === null ? null : sectorRotations(source);
    },

    /** Each listing against its market's index: a daily-bar request per listing, and one per market for its index. */
    listings,

    /** A listing against any other listing or index; a daily-bar request each. */
    rotationAgainst: (symbol: SymbolRef, benchmark: SymbolRef) =>
      against(symbol, daily(benchmark)),

    /**
     * A listing against its market's index and, for a TWSE company whose industry has a sector
     * index, against that index too; the exchange's list says which industry it is in.
     */
    async listing(symbol: SymbolRef): Promise<ListingRotationView> {
      const [[own], listed] = await Promise.all([
        listings([symbol]),
        symbol.market === Market.TW ? company(symbol) : null,
      ]);

      const sector = listed && sectorOfIndustry(listed.industry.code);
      const index = TW_SECTOR_INDICES.find((each) => each.sector === sector);

      return {
        index: { name: BENCHMARK[symbol.market].name, readings: own.readings },
        sector:
          sector && index
            ? {
                sector,
                symbol: index.symbol,
                readings: await against(
                  symbol,
                  daily({ market: Market.TW, symbol: index.symbol })
                ),
              }
            : null,
      };
    },
  };
}

export type Rotations = ReturnType<typeof createRotations>;
