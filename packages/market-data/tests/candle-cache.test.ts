import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";

import { Interval, isIntraday } from "@solyx/core/candles";
import type { Candle } from "@solyx/core/candles";
import { Market, exchangeDate, shiftDate } from "@solyx/core/market";
import type {
  CandleRequest,
  MarketDataProvider,
} from "@solyx/core/market-data";
import { openCache } from "@solyx/db/cache";
import type { Cache } from "@solyx/db/cache";

import { withCandleCache } from "../src/candle-cache.ts";

// The cache database's migrations, as @solyx/db keeps them.
const MIGRATIONS = fileURLToPath(
  new URL("../../db/migrations/cache", import.meta.url)
);

const TSMC = { market: Market.TW, symbol: "2330" };

/** 10:00 in Taipei on a date. */
function duringSession(date: string): Date {
  return new Date(`${date}T10:00:00+08:00`);
}

function taipei(date: string, time = "00:00"): number {
  return Date.parse(`${date}T${time}:00+08:00`) / 1000;
}

const LIVE_CLOSE = -1;

/**
 * Weekday bars with a close derived from the date; today's bars close at `LIVE_CLOSE`
 * until the day is over, as a live session would.
 */
function fakeProvider(
  clock: { now: Date },
  id = "fake",
  holidays: string[] = []
) {
  const calls: Pick<CandleRequest, "interval" | "from" | "to">[] = [];

  const provider: MarketDataProvider = {
    id,
    markets: [Market.TW],
    async getCandles({ interval, from, to }) {
      calls.push({ interval, from, to });

      const today = exchangeDate(Market.TW, clock.now);
      const bars: Candle[] = [];

      for (
        let date = from;
        date <= to && date <= today;
        date = shiftDate(date, 1)
      ) {
        const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();

        if (weekday === 0 || weekday === 6 || holidays.includes(date)) continue;

        const close = date === today ? LIVE_CLOSE : Number(date.slice(8));

        const times = isIntraday(interval)
          ? [taipei(date, "09:00"), taipei(date, "09:05")]
          : [taipei(date)];

        for (const time of times) {
          bars.push({
            time,
            open: close,
            high: close,
            low: close,
            close,
            volume: 1000,
          });
        }
      }

      return bars;
    },
  };

  return { provider, calls };
}

let directory: string;

let caches: Cache[];

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "solyx-candles-"));
  caches = [];
});

afterEach(async () => {
  for (const cache of caches) cache.close();
  await rm(directory, { recursive: true, force: true });
});

function open(file = "cache.sqlite") {
  const cache = openCache(join(directory, file), MIGRATIONS);

  caches.push(cache);

  return cache;
}

function setup(today = "2026-09-29", holidays: string[] = []) {
  const clock = { now: duringSession(today) };
  const { provider, calls } = fakeProvider(clock, "fake", holidays);

  const cached = withCandleCache(provider, open().candles, {
    now: () => clock.now,
  });

  const get = (interval: Interval, from: string, to: string) =>
    cached.getCandles({ symbol: TSMC, interval, from, to });

  return { clock, calls, get };
}

describe("withCandleCache", () => {
  test("a series is fetched once, then only today's session is asked for", async () => {
    const { calls, get } = setup();

    const first = await get(Interval.OneDay, "2026-09-01", "2026-09-29");
    const second = await get(Interval.OneDay, "2026-09-01", "2026-09-29");

    expect(second).toEqual(first);
    expect(calls).toEqual([
      { interval: Interval.OneDay, from: "2026-09-01", to: "2026-09-29" },
      { interval: Interval.OneDay, from: "2026-09-29", to: "2026-09-29" },
    ]);
  });

  test("a covered range of closed sessions makes no request", async () => {
    const { calls, get } = setup();

    await get(Interval.OneDay, "2026-09-01", "2026-09-25");
    const bars = await get(Interval.OneDay, "2026-09-01", "2026-09-25");

    expect(calls).toHaveLength(1);
    expect(bars.at(-1)?.time).toBe(taipei("2026-09-25"));
  });

  test("an earlier start asks only for the missing head", async () => {
    const { calls, get } = setup();

    await get(Interval.OneDay, "2026-09-10", "2026-09-25");
    const bars = await get(Interval.OneDay, "2026-09-01", "2026-09-25");

    expect(calls.at(-1)).toEqual({
      interval: Interval.OneDay,
      from: "2026-09-01",
      to: "2026-09-09",
    });
    expect(bars[0].time).toBe(taipei("2026-09-01"));
  });

  test("days after the newest bar are asked for again, since they may not be published yet", async () => {
    const { calls, get } = setup("2026-09-29", ["2026-09-28"]);

    await get(Interval.OneDay, "2026-09-01", "2026-09-29");
    await get(Interval.OneDay, "2026-09-01", "2026-09-29");

    expect(calls.at(-1)).toEqual({
      interval: Interval.OneDay,
      from: "2026-09-26",
      to: "2026-09-29",
    });
  });

  test("today's bars are served live and stored only once the session is over", async () => {
    const { clock, calls, get } = setup();

    const live = await get(Interval.OneDay, "2026-09-01", "2026-09-29");

    expect(live.at(-1)?.close).toBe(LIVE_CLOSE);

    clock.now = duringSession("2026-09-30");

    const next = await get(Interval.OneDay, "2026-09-01", "2026-09-30");

    expect(calls.at(-1)).toEqual({
      interval: Interval.OneDay,
      from: "2026-09-29",
      to: "2026-09-30",
    });
    expect(next.find((bar) => bar.time === taipei("2026-09-29"))?.close).toBe(
      29
    );
  });

  test("weekly and monthly bars are merged from cached daily bars", async () => {
    const { calls, get } = setup();

    const weeks = await get(Interval.OneWeek, "2026-09-01", "2026-09-29");
    const months = await get(Interval.OneMonth, "2026-09-01", "2026-09-29");

    expect(calls.map((call) => call.interval)).toEqual([
      Interval.OneDay,
      Interval.OneDay,
    ]);
    expect(calls[0].from).toBe("2026-08-31");
    expect(weeks.map((week) => week.time)).toEqual(
      [
        "2026-08-31",
        "2026-09-07",
        "2026-09-14",
        "2026-09-21",
        "2026-09-28",
      ].map((date) => taipei(date))
    );
    expect(months).toHaveLength(1);
  });

  test("intraday series keep only the requested window", async () => {
    const { calls, get } = setup();

    await get(Interval.FiveMinutes, "2026-09-24", "2026-09-29");
    await get(Interval.FiveMinutes, "2026-09-25", "2026-09-29");
    await get(Interval.FiveMinutes, "2026-09-24", "2026-09-29");

    // The trimmed day is asked for again, beside today's live session.
    expect(calls.slice(-2)).toEqual([
      { interval: Interval.FiveMinutes, from: "2026-09-24", to: "2026-09-24" },
      { interval: Interval.FiveMinutes, from: "2026-09-29", to: "2026-09-29" },
    ]);
  });

  test("a request starting past the covered span starts the series over", async () => {
    const { calls, get } = setup();

    await get(Interval.OneDay, "2026-09-01", "2026-09-10");
    await get(Interval.OneDay, "2026-09-20", "2026-09-29");
    await get(Interval.OneDay, "2026-09-01", "2026-09-29");

    expect(calls.slice(1)).toEqual([
      { interval: Interval.OneDay, from: "2026-09-20", to: "2026-09-29" },
      { interval: Interval.OneDay, from: "2026-09-01", to: "2026-09-19" },
      { interval: Interval.OneDay, from: "2026-09-29", to: "2026-09-29" },
    ]);
  });

  test("providers never share bars", async () => {
    const clock = { now: duringSession("2026-09-29") };
    const cache = open();
    const first = fakeProvider(clock, "first");
    const second = fakeProvider(clock, "second");

    const request = {
      symbol: TSMC,
      interval: Interval.OneDay,
      from: "2026-09-01",
      to: "2026-09-25",
    };

    await withCandleCache(first.provider, cache.candles).getCandles(request);
    await withCandleCache(second.provider, cache.candles).getCandles(request);

    expect(second.calls).toHaveLength(1);
  });
});
