import { delay } from "es-toolkit";

import type { ListingRotationView } from "@solyx/api/market";
import { adjustedCandles } from "@solyx/core/candles";
import type { Candle } from "@solyx/core/candles";
import type { Company } from "@solyx/core/fundamentals";
import {
  BENCHMARK,
  Market,
  exchangeDate,
  exchangeMidnight,
  isTwIndex,
  symbolKey,
  symbolLabel,
} from "@solyx/core/market";
import type { SymbolRef } from "@solyx/core/market";
import type { Quote } from "@solyx/core/market-data";
import {
  BENCHMARK_SESSIONS,
  PLAYBACK_SESSIONS,
  RotationAgainst,
  benchmarkFitness,
  dateBars,
  playbackPath,
  readingThrough,
  rotationPaths,
  weekUnderWay,
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
import type { SectorQuote } from "@solyx/core/sectors";
import { Session, getSession, weekdays } from "@solyx/core/session";
import { MINUTE_MS, shiftDate } from "@solyx/utils/date";
import { keepFresh, memoryAnswers } from "@solyx/utils/fresh";

/** Through the regular session the newest bar still moves, so bars read then are read again this much later. */
const LIVE_FRESH_MS = 5 * MINUTE_MS;

/**
 * Days of daily bars a rotation reads: the 52-week period's two windows, the last
 * `PLAYBACK_SESSIONS` and a trail, in three of the 360-day ranges a Fugle request takes.
 */
const SPAN_DAYS = 1080;

/** The newest of those ranges, whose daily periods a graph shows while the years before it are read. */
const RECENT_DAYS = 360;

/** How long the whole span may take after the newest year before a graph is shown that year's paths. */
const WHOLE_GRACE_MS = 250;

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

/**
 * `whole`, and before it `recent` where `whole` has yet to come `WHOLE_GRACE_MS` after it, so what
 * the cache holds is answered once and what a source must send shows its newest year first. A
 * `recent` that fails leaves `whole` to answer, and a `whole` that fails still has `recent` shown.
 */
async function* newestFirst<Answer>(
  recent: Promise<Answer>,
  whole: Promise<Answer>
) {
  const done = whole.then((answer) => ({ answer, complete: true }));

  const early = recent.then(async (answer) => {
    await delay(WHOLE_GRACE_MS);

    return { answer, complete: false };
  });

  const first = await Promise.race([
    done.catch(() => early),
    early.catch(() => done),
  ]);

  yield first;

  if (!first.complete) yield await done;
}

/** A listing's or index's daily bars, as one of the module's readers keeps them. */
type ReadBars = (symbol: SymbolRef) => Promise<Candle[]>;

/** A session's quote as its daily bar, at its last price throughout, since a rotation reads only the close. */
const quoteBar = (
  market: Market,
  { date, last, reference }: Quote
): Candle => ({
  time: exchangeMidnight(market, date),
  open: last,
  high: last,
  low: last,
  close: last,
  volume: 0,
  reference,
});

interface RotationsOptions {
  /** A listing's daily bars from `from` through `to`, through the candle cache; rejects while no source covers its market. */
  candlesBetween(
    symbol: SymbolRef,
    from: string,
    to: string
  ): Promise<Candle[]>;
  /** The id of the source covering `market`; `null` while none does. */
  sourceId(market: Market): Promise<string | null>;
  /** Which company a Taiwan listing is, for its industry; `null` where the exchange's list has none. */
  company(symbol: SymbolRef): Promise<Company | null>;
  /** Every Taiwan sector index's quote, the read the overview's map shares; `null` while no source covers Taiwan. */
  sectorQuotes(): Promise<SectorQuote[] | null>;
  /** @default () => new Date() */
  now?: () => Date;
}

/**
 * Every rotation the app reads, on daily bars through the candle cache: the sectors against the
 * TAIEX, listings against their market's index or any benchmark, each over every interval and
 * period, as readings as of the newest session or any of the last `PLAYBACK_SESSIONS`, or as the
 * paths across those sessions a graph plays back, over the newest year first where the years
 * before it must come from the source. Listings' bars are adjusted for splits and what went ex; an
 * index's need no adjusting. A listing's or index's session is its own intraday bars, but for the
 * sector indices read together, whose sessions are the quotes the overview's map reads anyway, so
 * the sectors cost the plan's intraday budget no request of their own. Every listing's and index's
 * bars are kept in memory while the session they were read in lasts, since every path is worked
 * out from them afresh and a change of benchmark should cost no request.
 */
export function createRotations({
  candlesBetween,
  sourceId,
  company,
  sectorQuotes,
  now = () => new Date(),
}: RotationsOptions) {
  const today = (market: Market) => exchangeDate(market, now());

  const daysBack = (market: Market, days: number) =>
    shiftDate(today(market), -days);

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
      weekUnderWay(symbol.market, now())
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

  const fresh = ({ market }: SymbolRef, askedAt: number, at: number) =>
    barsFresh(market, askedAt, at);

  /**
   * Daily bars kept under `scope`: `recent`, the newest `RECENT_DAYS` through today as `newest`
   * reads them from a first day, and `span`, the whole `SPAN_DAYS`, the years before read after.
   */
  function spanReaders(
    scope: string,
    newest: (symbol: SymbolRef, from: string) => Promise<Candle[]>
  ) {
    const recent = keepFresh<SymbolRef, Candle[]>({
      store: answers(`${scope}:recent`),
      id: symbolKey,
      ask: (symbol) => newest(symbol, daysBack(symbol.market, RECENT_DAYS)),
      fresh,
      now: () => now().getTime(),
    });

    const span = keepFresh<SymbolRef, Candle[]>({
      store: answers(scope),
      id: symbolKey,
      async ask(symbol) {
        const kept = await recent(symbol);

        const older = await candlesBetween(
          symbol,
          daysBack(symbol.market, SPAN_DAYS),
          daysBack(symbol.market, RECENT_DAYS + 1)
        );

        return [...older, ...kept];
      },
      fresh,
      now: () => now().getTime(),
    });

    return { recent, span };
  }

  /** Each listing's and index's bars, today's session from its own intraday bars. */
  const bars = spanReaders("market:rotation-bars", (symbol, from) =>
    candlesBetween(symbol, from, today(symbol.market))
  );

  /** The sector indices' bars as the sectors are read together: the sessions closed, then each one's quote. */
  const sectorBars = spanReaders(
    "market:rotation-sector-bars",
    async (symbol, from) => {
      const [closed, quotes] = await Promise.all([
        candlesBetween(symbol, from, daysBack(symbol.market, 1)),
        sectorQuotes(),
      ]);

      const quote = quotes?.find(
        (each) => each.symbol === symbol.symbol
      )?.quote;

      const session = quote && quoteBar(symbol.market, quote);

      return session && session.time > (closed.at(-1)?.time ?? -Infinity)
        ? [...closed, session]
        : closed;
    }
  );

  /** What the reads of the newest year take their bars from, and the reads of the whole span. */
  const newestYear = { bars: bars.recent, sectors: sectorBars.recent };
  const wholeSpan = { bars: bars.span, sectors: sectorBars.span };

  /** Whether `symbol` is its market's own index, which needs no adjusting and always qualifies as a benchmark. */
  const isMarketIndex = (symbol: SymbolRef) =>
    symbolKey(symbol) === symbolKey(BENCHMARK[symbol.market].symbol);

  /**
   * A benchmark's bars: an index's as they are, and a listing's adjusted once it qualifies over
   * the market's last sessions, so a halt in it breaks no window.
   */
  async function benchmarkBars(
    benchmark: SymbolRef,
    through: string | undefined,
    read: ReadBars
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
    benchmark: Promise<Candle[]>,
    read: ReadBars
  ): Promise<RotationPath[]> {
    const [bars, other] = await Promise.all([read(symbol), benchmark]);

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
    }: ListingsOptions,
    read: ReadBars
  ) {
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
          paths: own ? await against(symbol, barsOf(own), read) : [],
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
  async function sectorPaths(
    read: typeof wholeSpan,
    through?: string,
    benchmark?: SymbolRef
  ) {
    if ((await sourceId(Market.TW)) === null) return null;

    const taiex = BENCHMARK[Market.TW].symbol;

    if (benchmark && benchmark.market !== Market.TW) {
      throw new Error(
        `${symbolLabel(benchmark)} is not a Taiwan listing, so the sectors cannot be read against it`
      );
    }

    const indices = TW_SECTOR_INDICES.map((index) => ({
      index,
      symbol: { market: Market.TW, symbol: index.symbol },
    }));

    const [calendar, each, other] = await Promise.all([
      read.bars(taiex),
      Promise.all(indices.map(({ symbol }) => read.sectors(symbol))),
      benchmark && !isMarketIndex(benchmark)
        ? benchmarkBars(benchmark, through, read.bars)
        : null,
    ]);

    const against = other ?? calendar;

    return {
      benchmark: benchmark ?? taiex,
      bars: against,
      sessions: sessions(Market.TW, calendar),
      entries: indices.map(({ index, symbol }, i) => ({
        ...index,
        paths: paths(symbol, each[i], against),
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
      const read = await sectorPaths(wholeSpan, through, benchmark);

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

    /** The sectors' paths across the sessions a graph may play them back over, as `sectors` reads them, the newest year's first where the rest must come from the source. */
    async *sectorHistory(
      benchmark?: SymbolRef
    ): AsyncGenerator<RotationHistory<SectorHistory> | null> {
      const history = async (reads: typeof wholeSpan) => {
        const read = await sectorPaths(reads, undefined, benchmark);

        return (
          read && {
            benchmark: read.benchmark,
            sessions: read.sessions,
            closes: closesOn(Market.TW, read.bars, read.sessions),
            entries: read.entries.map(({ paths: all, ...index }) => ({
              ...index,
              paths: playback(all, read.sessions),
            })),
          }
        );
      };

      for await (const { answer, complete } of newestFirst(
        history(newestYear),
        history(wholeSpan)
      )) {
        yield answer && { ...answer, complete };
      }
    },

    /** Each listing against its market's index: a daily-bar request per listing, and one per market for its index. */
    async listings(
      symbols: readonly SymbolRef[],
      options: ListingsOptions = {}
    ): Promise<RotationSet<ListingRotation>> {
      const read = await listingPaths(symbols, options, wholeSpan.bars);

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

    /** The listings' paths across the sessions a graph may play them back over, as `listings` reads them, the newest year's first where the rest must come from the source. */
    async *listingHistory(
      symbols: readonly SymbolRef[],
      options: Omit<ListingsOptions, "through"> = {}
    ): AsyncGenerator<RotationHistory<ListingHistory>> {
      const history = async (each: ReadBars) => {
        const read = await listingPaths(symbols, options, each);
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
                await benchmarkBars(one, undefined, each),
                read.sessions
              )
            : null,
          entries: read.entries.map(({ paths: all, ...entry }) => ({
            ...entry,
            paths: playback(all, read.sessions),
          })),
        };
      };

      for await (const { answer, complete } of newestFirst(
        history(newestYear.bars),
        history(wholeSpan.bars)
      )) {
        yield { ...answer, complete };
      }
    },

    /**
     * A listing against its market's index and, for a TWSE company whose industry has a sector
     * index, against that index too; the exchange's list says which industry it is in.
     */
    async listing(symbol: SymbolRef): Promise<ListingRotationView> {
      const [own, index] = await Promise.all([
        listingPaths([symbol], {}, wholeSpan.bars),
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
                  wholeSpan.bars({ market: Market.TW, symbol: index.symbol }),
                  wholeSpan.bars
                )
              ),
            }
          : null,
      };
    },
  };
}
