import * as z from "zod";

import { Interval, candleDate, mergeCandles, periodStart } from "./candles.ts";
import type { Candle } from "./candles.ts";
import { RELATIVE_STRENGTH_PERIODS } from "./indicators.ts";
import type { IndicatorLine } from "./indicators.ts";
import type { Market, SymbolRef } from "./market.ts";
import type { SectorIndex } from "./sectors.ts";

/**
 * Where a listing stands on its rotation against a benchmark: ahead of it and still gaining
 * (leading), ahead but fading (weakening), behind and still losing (lagging), or behind but
 * catching up (improving).
 */
export const Quadrant = {
  Leading: "leading",
  Weakening: "weakening",
  Lagging: "lagging",
  Improving: "improving",
} as const;

export type Quadrant = (typeof Quadrant)[keyof typeof Quadrant];

export function quadrantOf(level: number, momentum: number): Quadrant {
  if (level >= 0) return momentum >= 0 ? Quadrant.Leading : Quadrant.Weakening;

  return momentum >= 0 ? Quadrant.Improving : Quadrant.Lagging;
}

// Variation within 32 ulps of the values' magnitude is rounding, not a move, so no z-score
// reads it.
const PRECISION = 32 * Number.EPSILON;

// Below this share of the values' mean square, a variance from running sums may be mostly
// rounding, so the window is summed again on its own terms.
const SUMS_RELIABLE = 1e-6;

/** The last of `window` in standard deviations from their mean, centred and scaled first so rounding stays below the guard; `null` where they do not vary beyond it. */
function exactZ(window: readonly number[]): number | null {
  const base = window[0];
  let scale = 0;
  let magnitude = 0;

  for (const each of window) {
    scale = Math.max(scale, Math.abs(each - base));
    magnitude = Math.max(magnitude, Math.abs(each));
  }

  if (scale <= PRECISION * magnitude) return null;

  let sum = 0;

  for (const each of window) sum += (each - base) / scale;

  const mean = sum / window.length;
  let variance = 0;

  for (const each of window) variance += ((each - base) / scale - mean) ** 2;

  variance /= window.length;

  return ((window.at(-1)! - base) / scale - mean) / Math.sqrt(variance);
}

/** The values from `start` to `end`, or `null` where one of them is. */
function windowOf(
  values: readonly (number | null)[],
  start: number,
  end: number
): number[] | null {
  const window: number[] = [];

  for (let i = start; i <= end; i++) {
    const each = values[i];

    if (each === null) return null;

    window.push(each);
  }

  return window;
}

/** One value of a window on a monotonic queue, with where it stands. */
interface Queued {
  index: number;
  value: number;
}

/**
 * Each value's distance from the mean of the `period` values ending with it, in their population
 * standard deviations; `null` while those values are fewer, where any of them is `null`, or
 * where they do not vary beyond rounding. Running sums over the values less the first one, with
 * the window's range kept on monotonic queues, read every window in one pass; a window whose
 * variance those sums cannot vouch for is summed again on its own.
 */
export function rollingZ(
  values: readonly (number | null)[],
  period: number
): IndicatorLine {
  const line: IndicatorLine = new Array<number | null>(values.length).fill(
    null
  );

  const base = values.find((each) => each !== null);

  if (base === undefined) return line;

  // The window's values highest first and lowest first, each queue dropping what a newer value outdoes.
  const highs: Queued[] = [];
  const lows: Queued[] = [];
  let sum = 0;
  let squares = 0;
  let lastNull = -1;

  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    const start = i - period + 1;
    const dropped = start > 0 ? values[start - 1] : null;

    if (dropped !== null) {
      const gone = dropped - base;

      sum -= gone;
      squares -= gone * gone;
    }

    if (value === null) {
      lastNull = i;
      continue;
    }

    const centred = value - base;

    sum += centred;
    squares += centred * centred;

    while (highs.length > 0 && highs[highs.length - 1].value <= value) {
      highs.pop();
    }

    highs.push({ index: i, value });

    while (lows.length > 0 && lows[lows.length - 1].value >= value) {
      lows.pop();
    }

    lows.push({ index: i, value });

    while (highs[0].index < start) highs.shift();

    while (lows[0].index < start) lows.shift();

    if (start < 0 || lastNull >= start) continue;

    const high = highs[0].value;
    const low = lows[0].value;
    const magnitude = Math.max(Math.abs(high), Math.abs(low));

    if (high - low <= PRECISION * magnitude) continue;

    const mean = sum / period;
    const variance = squares / period - mean * mean;

    if (variance > SUMS_RELIABLE * (squares / period)) {
      line[i] = (centred - mean) / Math.sqrt(variance);
    } else {
      const window = windowOf(values, start, i);

      line[i] = window && exactZ(window);
    }
  }

  return line;
}

/** A listing's rotation against a benchmark, one coordinate pair per bar. */
export interface Rotation {
  /** How far the listing's price over the benchmark's stands from its own `period`-bar mean, in standard deviations. */
  level: IndicatorLine;
  /** How far the level's latest change stands from its `period`-bar mean, in standard deviations. */
  momentum: IndicatorLine;
}

/**
 * `values` against `benchmark` over `period` bars, as a relative rotation graph plots them: the
 * level is the rolling z-score of their ratio and the momentum the rolling z-score of the level's
 * change, both over the same `period`, so the first pair comes after twice as many bars. Pass
 * the benchmark's closes at the same bars' times, `null` where it has none; a bar that either
 * lacks breaks every window it falls in rather than borrowing an earlier bar.
 */
export function rotation(
  values: readonly number[],
  benchmark: readonly (number | null)[],
  period: number
): Rotation {
  const ratio = values.map((value, i) => {
    const other = benchmark[i];

    return other === null || other <= 0 || value <= 0 ? null : value / other;
  });

  const level = rollingZ(ratio, period);

  const change = level.map((each, i) => {
    const before = i > 0 ? level[i - 1] : null;

    return each === null || before === null ? null : each - before;
  });

  return { level, momentum: rollingZ(change, period) };
}

/** The bars a rotation is read over: a session each, or a completed week each. */
export const RotationInterval = {
  Daily: Interval.OneDay,
  Weekly: Interval.OneWeek,
} as const;

export type RotationInterval =
  (typeof RotationInterval)[keyof typeof RotationInterval];

export const rotationIntervalSchema = z.enum(RotationInterval);

/**
 * The periods a rotation is read over, per interval: a month, a quarter and half a year of
 * sessions, as relative strength is read, or a quarter, half a year and a year of weeks.
 */
export const ROTATION_PERIODS: Record<RotationInterval, readonly number[]> = {
  [RotationInterval.Daily]: RELATIVE_STRENGTH_PERIODS,
  [RotationInterval.Weekly]: [13, 26, 52],
};

/** How many bars of a rotation are plotted and cited: two weeks of sessions, or ten weeks. */
export const ROTATION_TRAIL = 10;

/** A rotation's place on one bar. */
export interface RotationStop {
  /** The exchange-local day of the bar's session, or of the last session of its week. */
  date: string;
  level: number;
  momentum: number;
}

/** A trail's last crossing from one quadrant into another, dated by the bar it entered `to` at. */
export interface Transition {
  from: Quadrant;
  to: Quadrant;
  date: string;
}

/** The last crossing between consecutive stops of `trail`; `null` where it stays in one quadrant. */
export function lastTransition(
  trail: readonly RotationStop[]
): Transition | null {
  for (let i = trail.length - 1; i > 0; i--) {
    const to = quadrantOf(trail[i].level, trail[i].momentum);
    const from = quadrantOf(trail[i - 1].level, trail[i - 1].momentum);

    if (from !== to) return { from, to, date: trail[i].date };
  }

  return null;
}

/** A listing's rotation against its benchmark over one period, as the overview plots and the agent cites it. */
export interface RotationReading {
  interval: RotationInterval;
  period: number;
  /** The last `ROTATION_TRAIL` bars with both coordinates, oldest first; empty while the bars are too few. */
  trail: RotationStop[];
  /** Where the newest bar lies; `null` while the bars are too few. */
  quadrant: Quadrant | null;
  /** The trail's last crossing into the quadrant it ends in; `null` where it stays in one. */
  transition: Transition | null;
}

/** Every bar's place of a rotation over one period, oldest first, which a reading as of any of them is cut from. */
export interface RotationPath {
  interval: RotationInterval;
  period: number;
  /** Every bar with both coordinates; none while the bars are too few. */
  stops: RotationStop[];
}

/**
 * The reading `path` gives as of `through`, from its stops up to that day alone: since each
 * stop is read from its own bar and the ones before it, this is the reading the bars up to that
 * day would give. The newest where left out.
 */
export function readingThrough(
  { interval, period, stops }: RotationPath,
  through?: string
): RotationReading {
  let end = stops.length;

  if (through !== undefined) {
    while (end > 0 && stops[end - 1].date > through) end--;
  }

  const trail = stops.slice(Math.max(0, end - ROTATION_TRAIL), end);
  const last = trail.at(-1);

  return {
    interval,
    period,
    trail,
    quadrant: last ? quadrantOf(last.level, last.momentum) : null,
    transition: lastTransition(trail),
  };
}

/** The stops a reading as of `first` or any later day draws on: those after it, and the trail it ends. */
export function playbackPath(path: RotationPath, first: string): RotationPath {
  let end = path.stops.findIndex(({ date }) => date > first);

  if (end < 0) end = path.stops.length;

  return {
    ...path,
    stops: path.stops.slice(Math.max(0, end - ROTATION_TRAIL)),
  };
}

/** Daily bars with each one's exchange-local day and the day that opens its week, worked out once. */
export interface DatedBars {
  market: Market;
  bars: readonly Candle[];
  dates: readonly string[];
  weeks: readonly string[];
}

/** `bars` dated on the market's calendar, once, so every reading of them reads the dates rather than the clock. */
export function dateBars(market: Market, bars: readonly Candle[]): DatedBars {
  const dates = bars.map((bar) => candleDate(market, bar.time));

  return {
    market,
    bars,
    dates,
    weeks: dates.map((date) => periodStart(date, Interval.OneWeek)),
  };
}

/** Bars of a rotation's interval, with what each is matched and dated by. */
export interface RotationSeries {
  interval: RotationInterval;
  bars: Candle[];
  /** What a benchmark's bar is matched to each by: its time, or the first day of its week. */
  keys: string[];
  /** Each bar's exchange-local day: its session's, or its week's last session's. */
  dates: string[];
}

/**
 * Dated daily bars as `interval` reads them: as they are, or merged into weeks of the market's
 * calendar, the week starting `openWeek` left out, since a weekly reading is of closed weeks
 * alone. The bars keep the terms they came on, so adjust them first.
 */
export function rotationSeries(
  dated: DatedBars,
  interval: RotationInterval,
  openWeek: string | null
): RotationSeries {
  const { bars, dates, weeks } = dated;

  if (interval === RotationInterval.Daily) {
    return {
      interval,
      bars: [...bars],
      keys: bars.map((bar) => String(bar.time)),
      dates: [...dates],
    };
  }

  const series: RotationSeries = { interval, bars: [], keys: [], dates: [] };
  let start = 0;

  for (let i = 1; i <= bars.length; i++) {
    if (i < bars.length && weeks[i] === weeks[start]) continue;

    if (weeks[start] !== openWeek) {
      series.bars.push(mergeCandles(bars.slice(start, i)));
      series.keys.push(weeks[start]);
      series.dates.push(dates[i - 1]);
    }

    start = i;
  }

  return series;
}

/**
 * `series` against `benchmark` over `period` bars of their interval: the series is the listing's,
 * on one set of terms, and the benchmark's bars are matched to its by key.
 */
export function rotationPath(
  series: RotationSeries,
  benchmark: RotationSeries,
  period: number
): RotationPath {
  const closes = new Map(
    benchmark.keys.map((key, i) => [key, benchmark.bars[i].close])
  );

  const { level, momentum } = rotation(
    series.bars.map((bar) => bar.close),
    series.keys.map((key) => closes.get(key) ?? null),
    period
  );

  const stops: RotationStop[] = [];

  for (const [i, each] of level.entries()) {
    const other = momentum[i];

    if (each !== null && other !== null) {
      stops.push({ date: series.dates[i], level: each, momentum: other });
    }
  }

  return { interval: series.interval, period, stops };
}

/**
 * Every path of `daily` against `benchmark`, each interval's periods in `ROTATION_PERIODS` order,
 * the week of `today` left out of the weekly ones since it is under way. A week is dated by its
 * last session, so a reading as of a session within it leaves it out too.
 */
export function rotationPaths(
  daily: DatedBars,
  benchmark: DatedBars,
  today: string
): RotationPath[] {
  const open = periodStart(today, Interval.OneWeek);

  return Object.values(RotationInterval).flatMap((interval) => {
    const own = rotationSeries(daily, interval, open);
    const other = rotationSeries(benchmark, interval, open);

    return ROTATION_PERIODS[interval].map((period) =>
      rotationPath(own, other, period)
    );
  });
}

/** When a rotation is read: the exchange's day now, and the session it is taken back to where it is. */
export interface RotationClock {
  today: string;
  /** The last session read, as the graph stood at its close; the newest where left out. */
  through?: string;
}

/** Every reading of `daily` against `benchmark` as of the clock, each interval's periods in `ROTATION_PERIODS` order. */
export const readEveryRotation = (
  daily: DatedBars,
  benchmark: DatedBars,
  { today, through }: RotationClock
): RotationReading[] =>
  rotationPaths(daily, benchmark, today).map((path) =>
    readingThrough(path, through)
  );

/** Readings as of one session, with the sessions they may be taken back to. */
export interface RotationSet<Entry> {
  /** What every entry was read against; `null` where each names its own. */
  benchmark: SymbolRef | null;
  /** The session the readings are of. */
  asOf: string;
  /** The sessions the readings may be taken back to, oldest first and ending with the newest. */
  sessions: string[];
  entries: Entry[];
}

/** How many sessions back a rotation may be taken: half a year of them. */
export const PLAYBACK_SESSIONS = 120;

/** Rotations as paths over the sessions they may be played back across, so a graph takes them back to any of those without reading them again. */
export interface RotationHistory<Entry> {
  /** What every entry was read against; `null` where each names its own. */
  benchmark: SymbolRef | null;
  /** The sessions the paths may be played back across, oldest first and ending with the newest. */
  sessions: string[];
  /** The closes on `sessions` of the one benchmark every entry was read against, `null` on a session it lacks; `null` where entries name different ones. */
  closes: (number | null)[] | null;
  /** Each entry's paths, cut to what a reading as of the first session or a later one draws on (`playbackPath`). */
  entries: Entry[];
  /** `false` while the older bars are still read: the longer periods' paths then begin late or hold no stops yet. */
  complete: boolean;
}

/** A sector index's rotation against the set's benchmark, one reading per interval and period. */
export interface SectorRotation extends SectorIndex {
  readings: RotationReading[];
}

/** A sector index's paths against the set's benchmark, one per interval and period. */
export interface SectorHistory extends SectorIndex {
  paths: RotationPath[];
}

/** What listings are read against: their market's index, or each its own sector's. */
export const RotationAgainst = {
  Market: "market",
  Sector: "sector",
} as const;

export type RotationAgainst =
  (typeof RotationAgainst)[keyof typeof RotationAgainst];

export const rotationAgainstSchema = z.enum(RotationAgainst);

/** A listing's rotation on adjusted bars, one reading per interval and period. */
export interface ListingRotation {
  symbol: SymbolRef;
  /** What it was read against; `null` where nothing applies, as a sector's index to a listing outside the TWSE's industries, which leaves no readings. */
  benchmark: SymbolRef | null;
  readings: RotationReading[];
}

/** A listing's paths on adjusted bars, one per interval and period; none where it has no benchmark. */
export interface ListingHistory {
  symbol: SymbolRef;
  benchmark: SymbolRef | null;
  paths: RotationPath[];
}

/** Of the market's last `BENCHMARK_SESSIONS` sessions a benchmark must have traded on `BENCHMARK_TRADED` at least and never missed `BENCHMARK_GAP` in a row, since a bar it lacks breaks every window it falls in. */
export const BENCHMARK_SESSIONS = 240;

export const BENCHMARK_TRADED = 228;

export const BENCHMARK_GAP = 4;

/** How a listing qualifies as a benchmark over the market's last sessions. */
export interface BenchmarkFitness {
  /** How many of the market's sessions were read, `BENCHMARK_SESSIONS` unless the calendar is shorter. */
  sessions: number;
  /** On how many of them it traded. */
  traded: number;
  /** The most sessions in a row it missed. */
  longestGap: number;
  fit: boolean;
}

/**
 * Whether `bars` qualify as a benchmark against `calendar`, the market's own index's daily bars,
 * over the last `BENCHMARK_SESSIONS` of them up to `through`: a market's own index always does.
 */
export function benchmarkFitness(
  market: Market,
  calendar: readonly Candle[],
  bars: readonly Candle[],
  through?: string
): BenchmarkFitness {
  const sessions = calendar
    .map((bar) => candleDate(market, bar.time))
    .filter((date) => through === undefined || date <= through)
    .slice(-BENCHMARK_SESSIONS);

  const traded = new Set(bars.map((bar) => candleDate(market, bar.time)));
  let count = 0;
  let run = 0;
  let longestGap = 0;

  for (const date of sessions) {
    if (traded.has(date)) {
      count++;
      run = 0;
    } else {
      run++;
      longestGap = Math.max(longestGap, run);
    }
  }

  return {
    sessions: sessions.length,
    traded: count,
    longestGap,
    fit:
      sessions.length === BENCHMARK_SESSIONS &&
      count >= BENCHMARK_TRADED &&
      longestGap < BENCHMARK_GAP,
  };
}

/** How many listings one read of their rotations may take, each a daily-bar request. */
export const MAX_ROTATION_LISTINGS = 50;
