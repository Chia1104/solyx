import { groupBy, sumBy } from "es-toolkit";
import * as z from "zod";

import { exchangeDate, exchangeMidnight, shiftDate } from "./market.ts";
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

/** Calendar days of history to read per interval: enough bars for the slowest indicator to warm up, within Fugle's free-tier rate limit. */
const LOOKBACK_DAYS: Record<Interval, number> = {
  [Interval.OneMinute]: 5,
  [Interval.FiveMinutes]: 30,
  [Interval.FifteenMinutes]: 60,
  [Interval.ThirtyMinutes]: 120,
  [Interval.OneHour]: 180,
  [Interval.OneDay]: 2 * 365,
  [Interval.OneWeek]: 3 * 365,
  [Interval.OneMonth]: 5 * 365,
};

/** The exchange-local dates, `YYYY-MM-DD`, of the history charts and the agent read for `interval`. */
export function lookbackRange(
  market: Market,
  interval: Interval,
  at: Date = new Date()
) {
  const to = exchangeDate(market, at);

  return { from: shiftDate(to, -LOOKBACK_DAYS[interval]), to };
}

// Longer than any market's closure, such as Taiwan's Lunar New Year, so an empty page of older
// bars means the source has none.
const OLDER_PAGE_MIN_DAYS = 21;

/**
 * The exchange-local dates of the page of history that ends the day before the session of the
 * bar at `before`, as long as `interval`'s lookback but never shorter than any closure.
 */
export function olderRange(
  market: Market,
  interval: Interval,
  before: Candle["time"]
) {
  const to = shiftDate(candleDate(market, before), -1);
  const days = Math.max(LOOKBACK_DAYS[interval], OLDER_PAGE_MIN_DAYS);

  return { from: shiftDate(to, -days), to };
}

/** Bars shorter than a day. */
export type IntradayInterval = Exclude<
  Interval,
  typeof Interval.OneDay | CalendarInterval
>;

export function isIntraday(interval: Interval): interval is IntradayInterval {
  return interval !== Interval.OneDay && !isCalendarInterval(interval);
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

/** The exchange-local date, `YYYY-MM-DD`, of the session a bar opening at `time` belongs to. */
export function candleDate(market: Market, time: Candle["time"]): string {
  return exchangeDate(market, new Date(time * 1000));
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

/** Bars of one session or shorter, the ones providers serve. */
export type BarInterval = Exclude<Interval, CalendarInterval>;

/** The `YYYY-MM-DD` date that opens the week (Monday) or month containing `date`. */
export function periodStart(date: string, interval: CalendarInterval): string {
  const day = Temporal.PlainDate.from(date);

  const start =
    interval === Interval.OneMonth
      ? day.with({ day: 1 })
      : day.subtract({ days: day.dayOfWeek - 1 });

  return start.toString();
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
    periodStart(candleDate(market, candle.time), interval)
  );

  return Object.values(periods).map(mergeCandles);
}

const INTRADAY_SECONDS: Record<IntradayInterval, number> = {
  [Interval.OneMinute]: 60,
  [Interval.FiveMinutes]: 5 * 60,
  [Interval.FifteenMinutes]: 15 * 60,
  [Interval.ThirtyMinutes]: 30 * 60,
  [Interval.OneHour]: 60 * 60,
};

/**
 * The bar of `interval` holding the minute at `time`, merged from one session's minute bars in
 * time order; weekly and monthly bars also merge the period's earlier daily bars. Intraday bars
 * align to the clock, as providers align them for a session that opens on the hour.
 */
export function liveBar(
  minutes: readonly Candle[],
  time: number,
  interval: Interval,
  market: Market,
  earlierDaily: readonly Candle[] = []
): Candle | undefined {
  if (isIntraday(interval)) {
    const size = INTRADAY_SECONDS[interval];
    const start = time - (time % size);

    const bucket = minutes.filter(
      (minute) => minute.time >= start && minute.time < start + size
    );

    return bucket.length === 0
      ? undefined
      : { ...mergeCandles(bucket), time: start };
  }

  if (minutes.length === 0) return undefined;

  const day = {
    ...mergeCandles(minutes),
    time: exchangeMidnight(market, candleDate(market, time)),
  };

  return interval === Interval.OneDay
    ? day
    : mergeCandles([...earlierDaily, day]);
}

/** Replaces bars with the same time and inserts the rest in time order, returning a new array. */
export function upsertCandles(
  candles: readonly Candle[],
  updates: readonly Candle[]
): Candle[] {
  const next = [...candles];

  for (const candle of updates) {
    let index = next.length;

    while (index > 0 && next[index - 1].time > candle.time) index--;

    if (index > 0 && next[index - 1].time === candle.time) {
      next[index - 1] = candle;
    } else {
      next.splice(index, 0, candle);
    }
  }

  return next;
}
