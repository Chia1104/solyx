import type { ListingRotationView } from "@solyx/api/market";
import { Interval, adjustedCandles, lookbackRange } from "@solyx/core/candles";
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
  dateBars,
  playbackPath,
  readingThrough,
  rotationPaths,
} from "@solyx/core/rotation";
import type {
  DatedBars,
  ListingHistory,
  ListingRotation,
  RotationHistory,
  RotationPath,
  RotationSet,
  SectorHistory,
  SectorRotation,
} from "@solyx/core/rotation";
import { TW_SECTOR_INDICES, sectorOfIndustry } from "@solyx/core/sectors";
import { Session, getSession, weekdays } from "@solyx/core/session";
import { MINUTE_MS } from "@solyx/utils/date";
import { keepFresh, memoryAnswers } from "@solyx/utils/fresh";

/** Through the regular session the newest bar still moves, so bars read then are read again this much later. */
const LIVE_FRESH_MS = 5 * MINUTE_MS;

/**
 * Daily bars stand until the session under way ends: a read is fresh while the exchange's day and
 * its session are what they were, and through the regular session for `LIVE_FRESH_MS`. Every
 * weekday counts as traded here, which only has a holiday's bars read again sooner than needed.
 */
function barsFresh(market: Market, askedAt: number, now: number): boolean {
  const asked = new Date(askedAt);
  const at = new Date(now);

  if (exchangeDate(market, asked) !== exchangeDate(market, at)) return false;

  const session = getSession(market, at, weekdays);

  if (session !== getSession(market, asked, weekdays)) return false;

  return session !== Session.Regular || now - askedAt < LIVE_FRESH_MS;
}

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
 * period, as readings as of the newest session or any of the last `PLAYBACK_SESSIONS`, or as the
 * paths across those sessions a graph plays back. Listings' bars are adjusted for splits and what
 * went ex; an index's need no adjusting. Every listing's and index's bars are kept in memory while
 * the session they were read in lasts, since every path is worked out from them afresh and a
 * change of benchmark should cost no request.
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

  // Bars kept in memory are dated once, however many readings are taken from them.
  const dated = new WeakMap<readonly Candle[], DatedBars>();

  const dateOnce = (market: Market, bars: readonly Candle[]) => {
    let known = dated.get(bars);

    if (!known) {
      known = dateBars(market, bars);
      dated.set(bars, known);
    }

    return known;
  };

  const paths = (
    symbol: SymbolRef,
    bars: readonly Candle[],
    benchmark: readonly Candle[]
  ) =>
    rotationPaths(
      dateOnce(symbol.market, bars),
      dateOnce(symbol.market, benchmark),
      today(symbol.market)
    );

  /** The sessions a set may be taken back to, from the benchmark's bars: the last `PLAYBACK_SESSIONS`. */
  const sessions = (market: Market, benchmark: readonly Candle[]) =>
    dateOnce(market, benchmark).dates.slice(-PLAYBACK_SESSIONS);

  /** `benchmark`'s close on each of `days`, `null` on one it did not trade. */
  const closesOn = (
    market: Market,
    benchmark: readonly Candle[],
    days: readonly string[]
  ) => {
    const { dates } = dateOnce(market, benchmark);
    const closes = new Map(dates.map((date, i) => [date, benchmark[i].close]));

    return days.map((day) => closes.get(day) ?? null);
  };

  /** Readings as of `through`, or the paths cut to the sessions they may be played back across. */
  const readingsOf = (all: RotationPath[], through?: string) =>
    all.map((path) => readingThrough(path, through));

  const playback = (all: RotationPath[], days: readonly string[]) =>
    days.length === 0 ? all : all.map((path) => playbackPath(path, days[0]));

  const answers = memoryAnswers();

  const indexBars = keepFresh<string, Record<string, Candle[]>>({
    store: answers("market:rotation-bars"),
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
    fresh: (_source, askedAt, at) => barsFresh(Market.TW, askedAt, at),
    now: () => now().getTime(),
  });

  /** A listing's or benchmark's daily bars, kept as the indices' are, so sliding back and a change of benchmark cost no request. */
  const listingBars = keepFresh<SymbolRef, Candle[]>({
    store: answers("market:rotation-listing-bars"),
    id: symbolKey,
    ask: daily,
    fresh: ({ market }, askedAt, at) => barsFresh(market, askedAt, at),
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
    read = listingBars
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

  /** A listing's paths against `benchmark`'s bars, on its own bars adjusted. */
  async function against(
    symbol: SymbolRef,
    benchmark: Promise<Candle[]>
  ): Promise<RotationPath[]> {
    const [bars, other] = await Promise.all([listingBars(symbol), benchmark]);

    return paths(symbol, adjustedCandles(bars), other);
  }

  /** The index of the sector a TWSE company is classed in; `null` for any other listing. */
  async function sectorIndexOf(symbol: SymbolRef) {
    const listed = symbol.market === Market.TW ? await company(symbol) : null;
    const sector = listed && sectorOfIndustry(listed.industry.code);
    const index = TW_SECTOR_INDICES.find((each) => each.sector === sector);

    return sector && index ? { sector, symbol: index.symbol } : null;
  }

  interface ListingsOptions {
    /** The session a benchmark other than an index must qualify as of; the newest where left out. */
    through?: string;
    /** One benchmark for every listing, which must be of its market; the market's index where left out. */
    benchmark?: SymbolRef;
    /** @default RotationAgainst.Market */
    against?: RotationAgainst;
  }

  /** Each listing's paths, with the sessions they may be read as of: every market's together, so a graph of listings of both reaches every one. */
  async function listingPaths(
    symbols: readonly SymbolRef[],
    {
      through,
      benchmark,
      against: mode = RotationAgainst.Market,
    }: ListingsOptions = {}
  ) {
    const read = listingBars;
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
          paths: own ? await against(symbol, barsOf(own)) : [],
        };
      })
    );

    const days = new Set<string>();

    for (const market of new Set(symbols.map(({ market }) => market))) {
      for (const day of sessions(
        market,
        await read(BENCHMARK[market].symbol)
      )) {
        days.add(day);
      }
    }

    return {
      entries,
      sessions: [...days].toSorted().slice(-PLAYBACK_SESSIONS),
    };
  }

  /** The sectors' paths against `benchmark`, or the TAIEX, with the sessions they may be read as of; `null` when no source covers Taiwan. */
  async function sectorPaths(through?: string, benchmark?: SymbolRef) {
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
    const against = other ?? calendar;
    const symbol = (code: string) => ({ market: Market.TW, symbol: code });

    return {
      benchmark: benchmark ?? taiex,
      bars: against,
      sessions: sessions(Market.TW, calendar),
      entries: TW_SECTOR_INDICES.map((index) => ({
        ...index,
        paths: paths(symbol(index.symbol), bars[index.symbol] ?? [], against),
      })),
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
      const read = await sectorPaths(through, benchmark);

      if (read === null) return null;

      return {
        benchmark: read.benchmark,
        asOf: through ?? read.sessions.at(-1) ?? today(Market.TW),
        sessions: read.sessions,
        entries: read.entries.map(({ paths: all, ...index }) => ({
          ...index,
          readings: readingsOf(all, through),
        })),
      };
    },

    /** The sectors' paths across the sessions a graph may play them back over, as `sectors` reads them. */
    async sectorHistory(
      benchmark?: SymbolRef
    ): Promise<RotationHistory<SectorHistory> | null> {
      const read = await sectorPaths(undefined, benchmark);

      if (read === null) return null;

      return {
        benchmark: read.benchmark,
        sessions: read.sessions,
        closes: closesOn(Market.TW, read.bars, read.sessions),
        entries: read.entries.map(({ paths: all, ...index }) => ({
          ...index,
          paths: playback(all, read.sessions),
        })),
      };
    },

    /** Each listing against its market's index: a daily-bar request per listing, and one per market for its index. */
    async listings(
      symbols: readonly SymbolRef[],
      options: ListingsOptions = {}
    ): Promise<RotationSet<ListingRotation>> {
      const read = await listingPaths(symbols, options);

      return {
        benchmark: options.benchmark ?? null,
        asOf: options.through ?? read.sessions.at(-1) ?? today(Market.TW),
        sessions: read.sessions,
        entries: read.entries.map(({ paths: all, ...entry }) => ({
          ...entry,
          readings: readingsOf(all, options.through),
        })),
      };
    },

    /** The listings' paths across the sessions a graph may play them back over, as `listings` reads them. */
    async listingHistory(
      symbols: readonly SymbolRef[],
      options: Omit<ListingsOptions, "through"> = {}
    ): Promise<RotationHistory<ListingHistory>> {
      const read = await listingPaths(symbols, options);
      const one = read.entries[0]?.benchmark;

      const shared =
        one &&
        read.entries.every(
          ({ benchmark }) =>
            benchmark && symbolKey(benchmark) === symbolKey(one)
        );

      return {
        benchmark: options.benchmark ?? null,
        sessions: read.sessions,
        closes: shared
          ? closesOn(
              one.market,
              await benchmarkBars(one, undefined),
              read.sessions
            )
          : null,
        entries: read.entries.map(({ paths: all, ...entry }) => ({
          ...entry,
          paths: playback(all, read.sessions),
        })),
      };
    },

    /**
     * A listing against its market's index and, for a TWSE company whose industry has a sector
     * index, against that index too; the exchange's list says which industry it is in.
     */
    async listing(symbol: SymbolRef): Promise<ListingRotationView> {
      const [own, index] = await Promise.all([
        listingPaths([symbol]),
        sectorIndexOf(symbol),
      ]);

      return {
        index: {
          name: BENCHMARK[symbol.market].name,
          readings: readingsOf(own.entries[0].paths),
        },
        sector: index
          ? {
              ...index,
              readings: readingsOf(
                await against(
                  symbol,
                  listingBars({ market: Market.TW, symbol: index.symbol })
                )
              ),
            }
          : null,
      };
    },
  };
}

export type Rotations = ReturnType<typeof createRotations>;
