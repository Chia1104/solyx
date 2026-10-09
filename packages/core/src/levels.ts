import { maxBy, sumBy } from "es-toolkit";

import type { Candle } from "./candles.ts";
import { MOVING_AVERAGE_PERIODS, sma } from "./indicators.ts";
import type { IndicatorLine } from "./indicators.ts";

const [QUARTER_LINE, HALF_YEAR_LINE, YEAR_LINE] = MOVING_AVERAGE_PERIODS.long;

// Shares of a line's value a zone reaches either side of it.
const QUARTER_LINE_REACH = 0.02;

const HALF_YEAR_LINE_REACH = 0.03;

/** Sessions a volume profile reads, about half a year. */
export const PROFILE_SESSIONS = 120;

const PROFILE_BINS = 30;

// A slice beside the densest one joins its zone while it holds this share of the densest's volume.
const DENSE_SHARE = 0.6;

export interface PriceRange {
  low: number;
  high: number;
}

/** What a support zone is drawn from. */
export const ZoneKind = {
  QuarterLine: "quarter-line",
  HalfYearLine: "half-year-line",
  Volume: "volume",
} as const;

export type ZoneKind = (typeof ZoneKind)[keyof typeof ZoneKind];

export interface Zone extends PriceRange {
  kind: ZoneKind;
}

export interface VolumeSlice extends PriceRange {
  /** Shares traded within the slice's prices. */
  volume: number;
}

/** The highest high and lowest low of the last year of daily bars, Taiwan's year line long; `null` without bars. */
export function yearRange(daily: readonly Candle[]): PriceRange | null {
  const year = daily.slice(-YEAR_LINE);

  if (year.length === 0) return null;

  return {
    low: Math.min(...year.map((candle) => candle.low)),
    high: Math.max(...year.map((candle) => candle.high)),
  };
}

/**
 * Shares traded at each price over the last `PROFILE_SESSIONS` daily bars, in equal slices from
 * their lowest low to their highest high, lowest first. Each bar's volume is spread over its
 * range in proportion to how much of it each slice covers, and a bar that traded at one price
 * puts it all in the slice holding that price.
 */
export function volumeProfile(daily: readonly Candle[]): VolumeSlice[] {
  const bars = daily.slice(-PROFILE_SESSIONS);

  if (bars.length === 0) return [];

  const low = Math.min(...bars.map((bar) => bar.low));
  const high = Math.max(...bars.map((bar) => bar.high));

  if (high === low) {
    return [{ low, high, volume: sumBy(bars, (bar) => bar.volume) }];
  }

  const size = (high - low) / PROFILE_BINS;
  const volumes: number[] = Array.from({ length: PROFILE_BINS }, () => 0);

  const sliceOf = (price: number) =>
    Math.min(PROFILE_BINS - 1, Math.floor((price - low) / size));

  for (const bar of bars) {
    if (bar.high === bar.low) {
      volumes[sliceOf(bar.low)] += bar.volume;
      continue;
    }

    for (let i = sliceOf(bar.low); i <= sliceOf(bar.high); i++) {
      const covered =
        Math.min(bar.high, low + (i + 1) * size) -
        Math.max(bar.low, low + i * size);

      volumes[i] += (bar.volume * Math.max(covered, 0)) / (bar.high - bar.low);
    }
  }

  return volumes.map((volume, i) => ({
    low: low + i * size,
    high: i === PROFILE_BINS - 1 ? high : low + (i + 1) * size,
    volume,
  }));
}

/** The slice where the most shares traded, the profile's point of control. */
export function pointOfControl(
  profile: readonly VolumeSlice[]
): VolumeSlice | undefined {
  return maxBy(profile, (slice) => slice.volume);
}

/**
 * The run of slices wholly under `price` around the densest of them, while each holds at least
 * `DENSE_SHARE` of its volume.
 */
function denseRange(
  profile: readonly VolumeSlice[],
  price: number
): PriceRange | null {
  const under = profile.filter((slice) => slice.high <= price);
  const densest = pointOfControl(under);

  if (!densest || densest.volume === 0) return null;

  const floor = densest.volume * DENSE_SHARE;
  let first = under.indexOf(densest);
  let last = first;

  while (first > 0 && under[first - 1].volume >= floor) first--;

  while (last < under.length - 1 && under[last + 1].volume >= floor) last++;

  return { low: under[first].low, high: under[last].high };
}

/**
 * Where a pullback in an uptrend tends to find buyers, highest first, from daily bars: within
 * 2% of the quarter line and 3% of the half-year line while the last close is above each, and
 * the densest trading of the volume profile under the last close.
 */
export function supportZones(daily: readonly Candle[]): Zone[] {
  const last = daily.at(-1);

  if (!last) return [];

  const closes = daily.map((candle) => candle.close);
  const zones: Zone[] = [];

  const around = (kind: ZoneKind, period: number, reach: number) => {
    const line = sma(closes, period).at(-1);

    if (line !== null && line !== undefined && line < last.close) {
      zones.push({ kind, low: line * (1 - reach), high: line * (1 + reach) });
    }
  };

  around(ZoneKind.QuarterLine, QUARTER_LINE, QUARTER_LINE_REACH);
  around(ZoneKind.HalfYearLine, HALF_YEAR_LINE, HALF_YEAR_LINE_REACH);

  const dense = denseRange(volumeProfile(daily), last.close);

  if (dense) zones.push({ kind: ZoneKind.Volume, ...dense });

  return zones.toSorted((a, b) => b.high - a.high);
}

/** Indices of the bars whose close fell below `line` from at or above it on the bar before. */
export function breaksBelow(
  closes: readonly number[],
  line: IndicatorLine
): number[] {
  const breaks: number[] = [];

  for (let i = 1; i < closes.length; i++) {
    const before = line[i - 1];
    const now = line[i];

    if (
      before !== null &&
      now !== null &&
      closes[i - 1] >= before &&
      closes[i] < now
    ) {
      breaks.push(i);
    }
  }

  return breaks;
}
