import { describe, expect, test } from "vite-plus/test";

import {
  Interval,
  alignedCloses,
  liveBar,
  mergeCandles,
  olderRange,
  periodStart,
  resampleDaily,
  upsertCandles,
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

describe("olderRange", () => {
  test("ends the day before the oldest bar's session, a lookback long", () => {
    const before = session("2026-03-02", 1, 1).time;

    expect(olderRange(Market.TW, Interval.OneDay, before)).toEqual({
      from: "2024-03-01",
      to: "2026-03-01",
    });
  });

  test("an intraday page outlasts any closure, however short its lookback", () => {
    const before = Date.parse("2026-02-23T09:00:00+08:00") / 1000;

    expect(olderRange(Market.TW, Interval.OneMinute, before)).toEqual({
      from: "2026-02-01",
      to: "2026-02-22",
    });
  });
});

test("alignedCloses reads the other series' close at each bar's time", () => {
  const bars = [session("2026-03-02", 1, 1), session("2026-03-03", 1, 1)];
  const other = [session("2026-03-03", 1, 50)];

  expect(alignedCloses(bars, other)).toEqual([null, 50]);
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

function minute(clock: string, close: number, volume = 100): Candle {
  return {
    time: Date.parse(`2026-09-29T${clock}:00+08:00`) / 1000,
    open: close,
    high: close,
    low: close,
    close,
    volume,
  };
}

describe("liveBar", () => {
  // No trades between the 13:25 call auction and the 13:30 close, as on a real session.
  const minutes = [
    minute("09:00", 10),
    minute("09:04", 12),
    minute("09:05", 11),
    minute("13:24", 13),
    minute("13:30", 14, 500),
  ];

  test("five-minute bars align to the clock", () => {
    expect(
      liveBar(minutes, minute("09:04", 0).time, Interval.FiveMinutes, Market.TW)
    ).toEqual({
      ...mergeCandles(minutes.slice(0, 2)),
      time: minute("09:00", 0).time,
    });
  });

  test("the closing auction opens its own five-minute bar", () => {
    expect(
      liveBar(minutes, minute("13:30", 0).time, Interval.FiveMinutes, Market.TW)
    ).toEqual(minute("13:30", 14, 500));
  });

  test("the last hourly bar includes the closing auction", () => {
    const bar = liveBar(
      minutes,
      minute("13:30", 0).time,
      Interval.OneHour,
      Market.TW
    );

    expect(bar?.time).toBe(minute("13:00", 0).time);
    expect(bar?.volume).toBe(600);
  });

  test("the daily bar spans the session and opens at midnight", () => {
    expect(
      liveBar(minutes, minute("13:30", 0).time, Interval.OneDay, Market.TW)
    ).toEqual({
      ...mergeCandles(minutes),
      time: Date.parse("2026-09-29T00:00:00+08:00") / 1000,
    });
  });

  test("weekly bars add the week's earlier sessions", () => {
    const monday = session("2026-09-28", 9, 9);

    const week = liveBar(
      minutes,
      minute("13:30", 0).time,
      Interval.OneWeek,
      Market.TW,
      [monday]
    );

    expect(week?.time).toBe(monday.time);
    expect(week?.open).toBe(9);
    expect(week?.close).toBe(14);
    expect(week?.volume).toBe(1000 + 900);
  });
});

describe("upsertCandles", () => {
  const bars = [minute("09:00", 1), minute("09:01", 2)];

  test("replaces the bar with the same time", () => {
    expect(upsertCandles(bars, [minute("09:01", 3)])).toEqual([
      bars[0],
      minute("09:01", 3),
    ]);
  });

  test("appends newer bars and inserts missing ones in order", () => {
    expect(
      upsertCandles(bars, [minute("09:03", 4), minute("08:59", 0)]).map(
        (bar) => bar.close
      )
    ).toEqual([0, 1, 2, 4]);
  });

  test("leaves the input untouched", () => {
    upsertCandles(bars, [minute("09:01", 3)]);

    expect(bars[1].close).toBe(2);
  });
});
