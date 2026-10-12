import { expect, test, vi } from "vite-plus/test";

import { Market } from "@solyx/core/market";
import { ScheduleKind } from "@solyx/core/schedule";
import { weekdays } from "@solyx/core/session";

import { createScheduleDays } from "../src/main/modules/market/schedule-days.ts";
import type { MarketDays } from "../src/main/modules/market/trading-calendar.ts";

function setup() {
  const closedMonday = (date: string) =>
    weekdays(date) && date !== "2026-10-12";

  const marketDays = vi.fn<MarketDays>(async () => closedMonday);

  return { days: createScheduleDays(marketDays), marketDays };
}

const atEight = (tradingDaysOf: Market | null) => ({
  kind: ScheduleKind.FixedTime,
  time: "08:00",
  tradingDaysOf,
});

test("a time of day kept to a market reads that market's trading days", async () => {
  const { days, marketDays } = setup();

  expect((await days(atEight(Market.TW)))("2026-10-12")).toBe(false);
  expect(marketDays).toHaveBeenCalledExactlyOnceWith(Market.TW);
});

test("a schedule that names no market keeps to weekdays without asking", async () => {
  const { days, marketDays } = setup();

  expect(await days(atEight(null))).toBe(weekdays);
  expect(await days({ kind: ScheduleKind.Interval, everyMinutes: 60 })).toBe(
    weekdays
  );
  expect(marketDays).not.toHaveBeenCalled();
});
