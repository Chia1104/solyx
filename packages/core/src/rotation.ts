import { groupBy } from "es-toolkit";
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
// reads it, and the window is centred on its first value before scaling for the same reason.
const PRECISION = 32 * Number.EPSILON;

/**
 * Each value's distance from the mean of the `period` values ending with it, in their population
 * standard deviations; `null` while those values are fewer, where any of them is `null`, or
 * where they do not vary beyond rounding.
 */
export function rollingZ(
  values: readonly (number | null)[],
  period: number
): IndicatorLine {
  return values.map((value, i) => {
    if (i < period - 1 || value === null) return null;

    const window = values.slice(i - period + 1, i + 1);

    if (window.some((each) => each === null)) return null;

    // SAFETY: every null was returned on above.
    const window_ = window as number[];
    const base = window_[0];
    let scale = 0;
    let magnitude = 0;

    for (const each of window_) {
      scale = Math.max(scale, Math.abs(each - base));
      magnitude = Math.max(magnitude, Math.abs(each));
    }

    if (scale <= PRECISION * magnitude) return null;

    const scaled = window_.map((each) => (each - base) / scale);
    const mean = scaled.reduce((sum, each) => sum + each, 0) / period;

    const variance =
      scaled.reduce((sum, each) => sum + (each - mean) ** 2, 0) / period;

    return (scaled[period - 1] - mean) / Math.sqrt(variance);
  });
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

/** One bar's place on a rotation graph. */
export interface RotationPoint {
  /** Which bar, as an index into the bars the rotation was read from. */
  index: number;
  level: number;
  momentum: number;
}

/** The last `trail` bars with both coordinates, oldest first. */
export function rotationTrail(
  { level, momentum }: Rotation,
  trail: number
): RotationPoint[] {
  const points: RotationPoint[] = [];

  for (
    let index = level.length - 1;
    index >= 0 && points.length < trail;
    index--
  ) {
    const each = level[index];
    const other = momentum[index];

    if (each !== null && other !== null) {
      points.push({ index, level: each, momentum: other });
    }
  }

  return points.reverse();
}

/** A trail's last crossing from one quadrant into another. */
export interface Transition {
  from: Quadrant;
  to: Quadrant;
  /** The bar the trail entered `to` at. */
  index: number;
}

/** The last crossing between consecutive points of `trail`; `null` where it stays in one quadrant. */
export function lastTransition(
  trail: readonly RotationPoint[]
): Transition | null {
  for (let i = trail.length - 1; i > 0; i--) {
    const to = quadrantOf(trail[i].level, trail[i].momentum);
    const from = quadrantOf(trail[i - 1].level, trail[i - 1].momentum);

    if (from !== to) return { from, to, index: trail[i].index };
  }

  return null;
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

/** A listing's rotation against its benchmark over one period, as the overview plots and the agent cites it. */
export interface RotationReading {
  interval: RotationInterval;
  period: number;
  /** The last `ROTATION_TRAIL` bars with both coordinates, oldest first; empty while the bars are too few. */
  trail: RotationStop[];
  /** Where the newest bar lies; `null` while the bars are too few. */
  quadrant: Quadrant | null;
  /** The trail's last crossing into the quadrant it ends in; `null` where it stays in one. */
  transition: { from: Quadrant; to: Quadrant; date: string } | null;
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
 * Daily bars as `interval` reads them: as they are, or merged into weeks of the market's
 * calendar, the week starting `openWeek` left out, since a weekly reading is of closed weeks
 * alone. The bars keep the terms they came on, so adjust them first.
 */
export function rotationSeries(
  market: Market,
  interval: RotationInterval,
  daily: readonly Candle[],
  openWeek: string | null
): RotationSeries {
  if (interval === RotationInterval.Daily) {
    return {
      interval,
      bars: [...daily],
      keys: daily.map((bar) => String(bar.time)),
      dates: daily.map((bar) => candleDate(market, bar.time)),
    };
  }

  const weeks = Object.entries(
    groupBy(daily, (bar) =>
      periodStart(candleDate(market, bar.time), Interval.OneWeek)
    )
  ).filter(([week]) => week !== openWeek);

  return {
    interval,
    bars: weeks.map(([, bars]) => mergeCandles(bars)),
    keys: weeks.map(([week]) => week),
    dates: weeks.map(([, bars]) => candleDate(market, bars.at(-1)!.time)),
  };
}

/**
 * `series` against `benchmark` over `period` bars of their interval: the series is the listing's,
 * on one set of terms, and the benchmark's bars are matched to its by key.
 */
export function readRotation(
  series: RotationSeries,
  benchmark: RotationSeries,
  period: number,
  trail = ROTATION_TRAIL
): RotationReading {
  const closes = new Map(
    benchmark.keys.map((key, i) => [key, benchmark.bars[i].close])
  );

  const stops = rotationTrail(
    rotation(
      series.bars.map((bar) => bar.close),
      series.keys.map((key) => closes.get(key) ?? null),
      period
    ),
    trail
  );

  const dated = stops.map(({ index, level, momentum }) => ({
    date: series.dates[index],
    level,
    momentum,
  }));

  const last = dated.at(-1);
  const crossed = lastTransition(stops);

  return {
    interval: series.interval,
    period,
    trail: dated,
    quadrant: last ? quadrantOf(last.level, last.momentum) : null,
    transition: crossed && {
      from: crossed.from,
      to: crossed.to,
      date: series.dates[crossed.index],
    },
  };
}

/** One reading per period of the series' interval, in `ROTATION_PERIODS` order. */
export const readRotations = (
  series: RotationSeries,
  benchmark: RotationSeries
): RotationReading[] =>
  ROTATION_PERIODS[series.interval].map((period) =>
    readRotation(series, benchmark, period)
  );

/** When a rotation is read: the exchange's day now, and the session it is taken back to where it is. */
export interface RotationClock {
  today: string;
  /** The last session read, as the graph stood at its close; the newest where left out. */
  through?: string;
}

/**
 * Every reading of `daily` against `benchmark` as of the clock: each interval's periods on bars
 * of that interval up to `through`, whose week is left out of the weekly ones while it is the
 * week under way or a later session of it was traded, since at its close that week was open.
 */
export function readEveryRotation(
  market: Market,
  daily: readonly Candle[],
  benchmark: readonly Candle[],
  { today, through }: RotationClock
): RotationReading[] {
  const until = through ?? today;
  const week = periodStart(until, Interval.OneWeek);

  const upTo = (bars: readonly Candle[]) =>
    bars.filter((bar) => candleDate(market, bar.time) <= until);

  const open =
    week === periodStart(today, Interval.OneWeek) ||
    daily.some((bar) => {
      const date = candleDate(market, bar.time);

      return date > until && periodStart(date, Interval.OneWeek) === week;
    })
      ? week
      : null;

  return Object.values(RotationInterval).flatMap((interval) =>
    readRotations(
      rotationSeries(market, interval, upTo(daily), open),
      rotationSeries(market, interval, upTo(benchmark), open)
    )
  );
}

/** Readings as of one session, with the sessions they may be taken back to. */
export interface RotationSet<Entry> {
  /** The session the readings are of. */
  asOf: string;
  /** The sessions the readings may be taken back to, oldest first and ending with the newest. */
  sessions: string[];
  entries: Entry[];
}

/** How many sessions back a rotation may be taken: half a year of them. */
export const PLAYBACK_SESSIONS = 120;

/** A sector index's rotation against its market's index, one reading per interval and period. */
export interface SectorRotation extends SectorIndex {
  readings: RotationReading[];
}

/** A listing's rotation against its market's index on adjusted bars, one reading per interval and period. */
export interface ListingRotation {
  symbol: SymbolRef;
  readings: RotationReading[];
}

/** How many listings one read of their rotations may take, each a daily-bar request. */
export const MAX_ROTATION_LISTINGS = 50;
