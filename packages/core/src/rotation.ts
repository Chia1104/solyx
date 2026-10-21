import { alignedCloses, candleDate } from "./candles.ts";
import type { Candle } from "./candles.ts";
import { RELATIVE_STRENGTH_PERIODS } from "./indicators.ts";
import type { IndicatorLine } from "./indicators.ts";
import type { Market } from "./market.ts";

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

/** The sessions a rotation is read over, as relative strength is: a month, a quarter and half a year. */
export const ROTATION_PERIODS = RELATIVE_STRENGTH_PERIODS;

/** How many sessions of a rotation are plotted and cited: two weeks of them. */
export const ROTATION_TRAIL = 10;

/** A rotation's place on one session. */
export interface RotationStop {
  /** The session's exchange-local day. */
  date: string;
  level: number;
  momentum: number;
}

/** A listing's rotation against its benchmark over one period, as the overview plots and the agent cites it. */
export interface RotationReading {
  period: number;
  /** The last `ROTATION_TRAIL` sessions with both coordinates, oldest first; empty while the bars are too few. */
  trail: RotationStop[];
  /** Where the newest session lies; `null` while the bars are too few. */
  quadrant: Quadrant | null;
  /** The trail's last crossing into the quadrant it ends in; `null` where it stays in one. */
  transition: { from: Quadrant; to: Quadrant; date: string } | null;
}

/**
 * `bars` against `benchmark` over `period` sessions: the bars are the listing's daily ones, on one
 * set of terms, and the benchmark's are matched to them by time.
 */
export function readRotation(
  market: Market,
  bars: readonly Candle[],
  benchmark: readonly Candle[],
  period: number,
  trail = ROTATION_TRAIL
): RotationReading {
  const stops = rotationTrail(
    rotation(
      bars.map((bar) => bar.close),
      alignedCloses(bars, benchmark),
      period
    ),
    trail
  );

  const dated = stops.map(({ index, level, momentum }) => ({
    date: candleDate(market, bars[index].time),
    level,
    momentum,
  }));

  const last = dated.at(-1);
  const crossed = lastTransition(stops);

  return {
    period,
    trail: dated,
    quadrant: last ? quadrantOf(last.level, last.momentum) : null,
    transition: crossed && {
      from: crossed.from,
      to: crossed.to,
      date: candleDate(market, bars[crossed.index].time),
    },
  };
}

/** One reading per period of `ROTATION_PERIODS`, in its order. */
export const readRotations = (
  market: Market,
  bars: readonly Candle[],
  benchmark: readonly Candle[]
): RotationReading[] =>
  ROTATION_PERIODS.map((period) =>
    readRotation(market, bars, benchmark, period)
  );
