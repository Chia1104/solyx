import { groupBy, sumBy } from "es-toolkit";
import * as z from "zod";

import { exchangeDate, shiftDate } from "./market.ts";
import type { Market } from "./market.ts";

export const Interval = {
  OneMinute: "1m",
  FiveMinutes: "5m",
  FifteenMinutes: "15m",
  ThirtyMinutes: "30m",
  OneHour: "1h",
  OneDay: "1d",
  OneWeek: "1w",
  OneMonth: "1mo",
} as const;

export type Interval = (typeof Interval)[keyof typeof Interval];

export const intervalSchema = z.enum(Interval);

const DAILY_OR_LONGER: ReadonlySet<Interval> = new Set([
  Interval.OneDay,
  Interval.OneWeek,
  Interval.OneMonth,
]);

export function isIntraday(interval: Interval): boolean {
  return !DAILY_OR_LONGER.has(interval);
}

export interface Candle {
  /** Bar open time in UTC seconds; daily and longer bars open at midnight exchange time. */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  /** Shares traded. */
  volume: number;
}

/** Weekly and monthly bars, which cover whole calendar periods of sessions. */
export type CalendarInterval =
  | typeof Interval.OneWeek
  | typeof Interval.OneMonth;

export function isCalendarInterval(
  interval: Interval
): interval is CalendarInterval {
  return interval === Interval.OneWeek || interval === Interval.OneMonth;
}

/** The `YYYY-MM-DD` date that opens the week (Monday) or month containing `date`. */
export function periodStart(date: string, interval: CalendarInterval): string {
  if (interval === Interval.OneMonth) return `${date.slice(0, 8)}01`;

  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();

  return shiftDate(date, -((weekday + 6) % 7));
}

/** Combines consecutive bars, oldest first, into one bar that opens with the first. */
export function mergeCandles(candles: readonly Candle[]): Candle {
  return {
    time: candles[0].time,
    open: candles[0].open,
    high: Math.max(...candles.map((candle) => candle.high)),
    low: Math.min(...candles.map((candle) => candle.low)),
    close: candles[candles.length - 1].close,
    volume: sumBy(candles, (candle) => candle.volume),
  };
}

/** Merges daily bars into weekly or monthly bars of the market's calendar; each opens with its first session. */
export function resampleDaily(
  daily: readonly Candle[],
  interval: CalendarInterval,
  market: Market
): Candle[] {
  const periods = groupBy(daily, (candle) =>
    periodStart(exchangeDate(market, new Date(candle.time * 1000)), interval)
  );

  return Object.values(periods).map(mergeCandles);
}
