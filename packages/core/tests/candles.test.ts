import { describe, expect, test } from "vite-plus/test";

import {
  Interval,
  mergeCandles,
  periodStart,
  resampleDaily,
} from "../src/candles.ts";
import type { Candle } from "../src/candles.ts";
import { Market } from "../src/market.ts";

function session(date: string, open: number, close: number): Candle {
  return {
    time: Date.parse(`${date}T00:00:00+08:00`) / 1000,
    open,
    high: Math.max(open, close) + 1,
    low: Math.min(open, close) - 1,
    close,
    volume: 1000,
  };
}

describe("periodStart", () => {
  test.each([
    { date: "2024-09-23", start: "2024-09-23" },
    { date: "2024-09-25", start: "2024-09-23" },
    { date: "2024-09-29", start: "2024-09-23" },
    { date: "2024-10-01", start: "2024-09-30" },
  ])("the week of $date opens on $start", ({ date, start }) => {
    expect(periodStart(date, Interval.OneWeek)).toBe(start);
  });

  test("a month opens on its first day", () => {
    expect(periodStart("2024-02-29", Interval.OneMonth)).toBe("2024-02-01");
  });
});

test("mergeCandles spans the bars' range and sums their volume", () => {
  expect(
    mergeCandles([session("2024-09-23", 10, 12), session("2024-09-24", 12, 9)])
  ).toEqual({
    time: session("2024-09-23", 10, 12).time,
    open: 10,
    high: 13,
    low: 8,
    close: 9,
    volume: 2000,
  });
});

describe("resampleDaily", () => {
  const daily = [
    session("2024-09-26", 10, 11),
    session("2024-09-27", 11, 12),
    session("2024-09-30", 12, 13),
    session("2024-10-01", 13, 14),
  ];

  test("weeks open with their first session", () => {
    const weeks = resampleDaily(daily, Interval.OneWeek, Market.TW);

    expect(weeks.map((week) => [week.time, week.open, week.close])).toEqual([
      [daily[0].time, 10, 12],
      [daily[2].time, 12, 14],
    ]);
  });

  test("months follow the exchange calendar", () => {
    const months = resampleDaily(daily, Interval.OneMonth, Market.TW);

    expect(months.map((month) => [month.time, month.volume])).toEqual([
      [daily[0].time, 3000],
      [daily[3].time, 1000],
    ]);
  });
});
