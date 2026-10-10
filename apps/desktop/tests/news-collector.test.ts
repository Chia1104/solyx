import { afterEach, expect, test, vi } from "vite-plus/test";

import { Market, symbolKey } from "@solyx/core/market";
import type { SymbolRef } from "@solyx/core/market";
import { ScheduleKind } from "@solyx/core/schedule";
import type { CollectionPlan } from "@solyx/core/schedule";
import { weekdays } from "@solyx/core/session";

import { createNewsCollector } from "../src/main/modules/news/news-collector.ts";

const TSMC = { market: Market.TW, symbol: "2330" };

const FOXCONN = { market: Market.TW, symbol: "2317" };

const HOUR_MS = 60 * 60 * 1000;

const taipei = (time: string) => Date.parse(`${time}+08:00`);

// 2026-10-08 is a Thursday.
const START = taipei("2026-10-08T07:00:00");

const EVERY_THREE_DAYS: CollectionPlan = {
  enabled: true,
  schedule: { kind: ScheduleKind.Interval, everyMinutes: 72 * 60 },
  timeZone: "Asia/Taipei",
};

afterEach(() => {
  vi.restoreAllMocks();
});

function setup(plan: CollectionPlan) {
  const clock = { now: START };
  const collected = new Map<string, Date>();

  // Collects as the news module does: only where the listing's last collection is due.
  const refresh = vi.fn(
    async (symbol: SymbolRef, due: (last: Date | null) => boolean) => {
      if (due(collected.get(symbolKey(symbol)) ?? null)) {
        collected.set(symbolKey(symbol), new Date(clock.now));
      }
    }
  );

  const diagnostics = { recovered: vi.fn() };
  const planned = { current: plan };

  const collector = createNewsCollector({
    news: {
      refresh,
      lastCollected: (symbol) => collected.get(symbolKey(symbol)) ?? null,
    },
    diagnostics,
    listings: async () => [TSMC, FOXCONN],
    plan: () => planned.current,
    days: async () => weekdays,
    now: () => clock.now,
  });

  return { collector, refresh, diagnostics, clock, collected, planned };
}

test("each listing held or watched is collected in turn once its span has passed", async () => {
  const { collector, refresh, clock, collected } = setup(EVERY_THREE_DAYS);

  await collector.work.run();

  expect(refresh.mock.calls.map(([symbol]) => symbol)).toEqual([TSMC, FOXCONN]);
  expect(collected.size).toBe(2);
  expect(await collector.status()).toEqual({
    lastAt: START,
    nextAt: START + 72 * HOUR_MS,
  });

  // The agent collected one of them a day later, which counts from then.
  collected.set(symbolKey(TSMC), new Date(START + 24 * HOUR_MS));
  clock.now = START + 72 * HOUR_MS;
  await collector.work.run();

  expect(collected.get(symbolKey(TSMC))).toEqual(
    new Date(START + 24 * HOUR_MS)
  );
  expect(collected.get(symbolKey(FOXCONN))).toEqual(
    new Date(START + 72 * HOUR_MS)
  );
});

test("a plan at a time of day collects once that time has come, and only on the days its market trades", async () => {
  const { collector, clock, collected } = setup({
    enabled: true,
    schedule: {
      kind: ScheduleKind.FixedTime,
      time: "08:00",
      tradingDaysOf: Market.TW,
    },
    timeZone: "Asia/Taipei",
  });

  // Never collected, so collected at once.
  await collector.work.run();

  expect(collected.get(symbolKey(TSMC))).toEqual(new Date(START));
  expect((await collector.status()).nextAt).toBe(taipei("2026-10-08T08:00:00"));

  clock.now = taipei("2026-10-08T08:10:00");
  await collector.work.run();

  expect(collected.get(symbolKey(TSMC))).toEqual(new Date(clock.now));

  // The app was closed on Friday morning: its time is made up for when it opens that evening.
  clock.now = taipei("2026-10-09T20:00:00");
  await collector.work.run();

  expect(collected.get(symbolKey(TSMC))).toEqual(new Date(clock.now));

  // Saturday: no time of day falls on it, so nothing is due until Monday.
  clock.now = taipei("2026-10-10T12:00:00");
  await collector.work.run();

  expect(collected.get(symbolKey(TSMC))).toEqual(
    new Date(taipei("2026-10-09T20:00:00"))
  );
  expect((await collector.status()).nextAt).toBe(taipei("2026-10-12T08:00:00"));
});

test("a plan switched off collects nothing until asked to collect now", async () => {
  const { collector, refresh, collected } = setup({
    ...EVERY_THREE_DAYS,
    enabled: false,
  });

  await collector.work.run();

  expect(refresh).not.toHaveBeenCalled();
  expect(await collector.status()).toEqual({ lastAt: null, nextAt: null });

  await collector.collectNow();

  expect(collected.size).toBe(2);
});

test("a listing whose refresh fails is logged by its listing and leaves the rest refreshed", async () => {
  const { collector, refresh, diagnostics } = setup(EVERY_THREE_DAYS);
  const failure = new Error("decisions model down");

  refresh.mockRejectedValueOnce(failure);
  await collector.work.run();

  expect(refresh).toHaveBeenCalledTimes(2);
  expect(diagnostics.recovered).toHaveBeenCalledWith(failure, "news.collect", {
    "solyx.listing": "TW:2330",
  });
});
