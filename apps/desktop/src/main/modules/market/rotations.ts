import {
  Interval,
  adjustedCandles,
  candleDate,
  lookbackRange,
} from "@solyx/core/candles";
import type { Candle } from "@solyx/core/candles";
import type { Company } from "@solyx/core/fundamentals";
import {
  BENCHMARK,
  Market,
  exchangeDate,
  isTwIndex,
  symbolKey,
  symbolLabel,
} from "@solyx/core/market";
import type { SymbolRef } from "@solyx/core/market";
import {
  BENCHMARK_SESSIONS,
  PLAYBACK_SESSIONS,
  RotationAgainst,
  benchmarkFitness,
  readEveryRotation,
} from "@solyx/core/rotation";
import type {
  ListingRotation,
  RotationReading,
  RotationSet,
  SectorRotation,
} from "@solyx/core/rotation";
import { TW_SECTOR_INDICES, sectorOfIndustry } from "@solyx/core/sectors";
import { MINUTE_MS } from "@solyx/utils/date";
import { freshFor, keepFresh, memoryAnswers } from "@solyx/utils/fresh";

import type { ListingRotationView } from "#shared/market.ts";

/** The indices' bars cost a daily-bar request each, so the overview's graph and the agent share a read this long. */
const BARS_FRESH_MS = MINUTE_MS;

interface RotationsOptions {
  /** A listing's daily bars from `since` on, through the candle cache; rejects while no source covers its market. */
  candlesSince(symbol: SymbolRef, since: string): Promise<Candle[]>;
  /** The id of the source covering `market`; `null` while none does. */
  sourceId(market: Market): Promise<string | null>;
  /** Which company a Taiwan listing is, for its industry; `null` where the exchange's list has none. */
  company(symbol: SymbolRef): Promise<Company | null>;
  /** @default () => new Date() */
  now?: () => Date;
}

/**
 * Every rotation the app reads, on daily bars through the candle cache: the sectors against the
 * TAIEX, listings against their market's index or any benchmark, each over every interval and
 * period, as of the newest session or any of the last `PLAYBACK_SESSIONS`. Listings' bars are
 * adjusted for splits and what went ex; an index's need no adjusting. The sector indices' bars are
 * kept in memory for a minute, since every reading of them is worked out afresh.
 */
export function createRotations({
  candlesSince,
  sourceId,
  company,
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
    benchmark: readonly Candle[],
    through: string | undefined
  ) =>
    readEveryRotation(symbol.market, bars, benchmark, {
      today: today(symbol.market),
      through,
    });

  /** The sessions a set may be taken back to, from the benchmark's bars: the last `PLAYBACK_SESSIONS` up to `asOf`. */
  const sessions = (market: Market, benchmark: readonly Candle[]) =>
    benchmark
      .map((bar) => candleDate(market, bar.time))
      .slice(-PLAYBACK_SESSIONS);

  const indexBars = keepFresh<string, Record<string, Candle[]>>({
    store: memoryAnswers()("market:rotation-bars"),
    id: (source) => source,
    async ask() {
      const taiex = BENCHMARK[Market.TW].symbol;

      const bars = await Promise.all(
        [
          taiex,
          ...TW_SECTOR_INDICES.map(({ symbol }) => ({
            market: Market.TW,
            symbol,
          })),
        ].map(async (symbol) => [symbol.symbol, await daily(symbol)] as const)
      );

      return Object.fromEntries(bars);
    },
    fresh: freshFor(BARS_FRESH_MS),
    now: () => now().getTime(),
  });

  /** Whether `symbol` is its market's own index, which needs no adjusting and always qualifies as a benchmark. */
  const isMarketIndex = (symbol: SymbolRef) =>
    symbolKey(symbol) === symbolKey(BENCHMARK[symbol.market].symbol);

  /**
   * A benchmark's bars: an index's as they are, and a listing's adjusted once it qualifies over
   * the market's last sessions, so a halt in it breaks no window. `read` is the daily bars, memoized
   * by the caller where it reads the same index for several listings.
   */
  async function benchmarkBars(
    benchmark: SymbolRef,
    through: string | undefined,
    read = daily
  ): Promise<Candle[]> {
    if (isMarketIndex(benchmark) || isTwIndex(benchmark)) {
      return read(benchmark);
    }

    const [bars, calendar] = await Promise.all([
      read(benchmark),
      read(BENCHMARK[benchmark.market].symbol),
    ]);

    const fitness = benchmarkFitness(benchmark.market, calendar, bars, through);

    if (!fitness.fit) {
      throw new Error(
        `${symbolLabel(benchmark)} cannot be a benchmark: it traded on ${fitness.traded} of the market's last ${fitness.sessions} sessions and missed ${fitness.longestGap} in a row, where ${BENCHMARK_SESSIONS} sessions with few missed and none for days are needed`
      );
    }

    return adjustedCandles(bars);
  }

  /** A listing's readings against `benchmark`'s bars, on its own bars adjusted. */
  async function against(
    symbol: SymbolRef,
    benchmark: Promise<Candle[]>,
    through?: string
  ): Promise<RotationReading[]> {
    const [bars, other] = await Promise.all([daily(symbol), benchmark]);

    return readings(symbol, adjustedCandles(bars), other, through);
  }

  /** The index of the sector a TWSE company is classed in; `null` for any other listing. */
  async function sectorIndexOf(symbol: SymbolRef) {
    const listed = symbol.market === Market.TW ? await company(symbol) : null;
    const sector = listed && sectorOfIndustry(listed.industry.code);
    const index = TW_SECTOR_INDICES.find((each) => each.sector === sector);

    return sector && index ? { sector, symbol: index.symbol } : null;
  }

  interface ListingsOptions {
    through?: string;
    /** One benchmark for every listing, which must be of its market; the market's index where left out. */
    benchmark?: SymbolRef;
    /** @default RotationAgainst.Market */
    against?: RotationAgainst;
  }

  async function listings(
    symbols: readonly SymbolRef[],
    {
      through,
      benchmark,
      against: mode = RotationAgainst.Market,
    }: ListingsOptions = {}
  ): Promise<RotationSet<ListingRotation>> {
    // Each index or benchmark is read once for every listing of the call.
    const reads = new Map<string, Promise<Candle[]>>();

    const read = (symbol: SymbolRef) => {
      const key = symbolKey(symbol);
      let bars = reads.get(key);

      if (!bars) {
        bars = daily(symbol);
        reads.set(key, bars);
      }

      return bars;
    };

    const barsOf = (symbol: SymbolRef) => benchmarkBars(symbol, through, read);

    const benchmarkOf = async (
      symbol: SymbolRef
    ): Promise<SymbolRef | null> => {
      if (benchmark) {
        if (benchmark.market !== symbol.market) {
          throw new Error(
            `${symbolLabel(benchmark)} is not of ${symbolLabel(symbol)}'s market, so it cannot be its benchmark`
          );
        }

        return benchmark;
      }

      if (mode === RotationAgainst.Sector) {
        const index = await sectorIndexOf(symbol);

        return index && { market: Market.TW, symbol: index.symbol };
      }

      return BENCHMARK[symbol.market].symbol;
    };

    const entries = await Promise.all(
      symbols.map(async (symbol) => {
        const own = await benchmarkOf(symbol);

        return {
          symbol,
          benchmark: own,
          readings: own ? await against(symbol, barsOf(own), through) : [],
        };
      })
    );

    // The markets' sessions together, so a slider over listings of both reaches every one.
    const days = new Set<string>();

    for (const market of new Set(symbols.map(({ market }) => market))) {
      for (const day of sessions(
        market,
        await read(BENCHMARK[market].symbol)
      )) {
        days.add(day);
      }
    }

    const all = [...days].toSorted().slice(-PLAYBACK_SESSIONS);

    return {
      benchmark: benchmark ?? null,
      asOf: through ?? all.at(-1) ?? today(Market.TW),
      sessions: all,
      entries,
    };
  }

  return {
    /**
     * Every Taiwan sector index against the TAIEX, or against `benchmark`, a TWSE listing or
     * index that qualifies, as of `through` or the newest session; `null` when no source covers
     * Taiwan.
     */
    async sectors(
      through?: string,
      benchmark?: SymbolRef
    ): Promise<RotationSet<SectorRotation> | null> {
      const source = await sourceId(Market.TW);

      if (source === null) return null;

      const taiex = BENCHMARK[Market.TW].symbol;

      if (benchmark && benchmark.market !== Market.TW) {
        throw new Error(
          `${symbolLabel(benchmark)} is not a Taiwan listing, so the sectors cannot be read against it`
        );
      }

      const [bars, other] = await Promise.all([
        indexBars(source),
        benchmark && !isMarketIndex(benchmark)
          ? benchmarkBars(benchmark, through)
          : null,
      ]);

      const calendar = bars[taiex.symbol] ?? [];
      const all = sessions(Market.TW, calendar);
      const symbol = (code: string) => ({ market: Market.TW, symbol: code });

      return {
        benchmark: benchmark ?? taiex,
        asOf: through ?? all.at(-1) ?? today(Market.TW),
        sessions: all,
        entries: TW_SECTOR_INDICES.map((index) => ({
          ...index,
          readings: readings(
            symbol(index.symbol),
            bars[index.symbol] ?? [],
            other ?? calendar,
            through
          ),
        })),
      };
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
      const [own, index] = await Promise.all([
        listings([symbol]),
        sectorIndexOf(symbol),
      ]);

      return {
        index: {
          name: BENCHMARK[symbol.market].name,
          readings: own.entries[0].readings,
        },
        sector: index
          ? {
              ...index,
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
