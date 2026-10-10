import { expect, test, vi } from "vite-plus/test";

import { Market } from "@solyx/core/market";
import { ScheduleKind } from "@solyx/core/schedule";
import { weekdays } from "@solyx/core/session";

import { createScheduleDays } from "../src/main/modules/market/schedule-days.ts";
import type { TradingCalendar } from "../src/main/modules/market/trading-calendar.ts";

function setup() {
  const closedMonday = (date: string) =>
    weekdays(date) && date !== "2026-10-12";

  const tradingDays = vi.fn<TradingCalendar>(async () => closedMonday);
  const diagnostics = { recovered: vi.fn() };

  return {
    days: createScheduleDays({ tradingDays, diagnostics }),
    tradingDays,
    diagnostics,
  };
}

const atEight = (tradingDaysOf: Market | null) => ({
  kind: ScheduleKind.FixedTime,
  time: "08:00",
  tradingDaysOf,
});

test("a time of day kept to a market reads that market's trading days", async () => {
  const { days, tradingDays } = setup();

  expect((await days(atEight(Market.TW)))("2026-10-12")).toBe(false);
  expect(tradingDays).toHaveBeenCalledExactlyOnceWith(Market.TW);
});

test("a schedule that names no market keeps to weekdays without asking", async () => {
  const { days, tradingDays } = setup();

  expect(await days(atEight(null))).toBe(weekdays);
  expect(await days({ kind: ScheduleKind.Interval, everyMinutes: 60 })).toBe(
    weekdays
  );
  expect(tradingDays).not.toHaveBeenCalled();
});

test("a market whose trading days cannot be read keeps to weekdays, and says so in the log", async () => {
  const { days, tradingDays, diagnostics } = setup();
  const failure = new Error("FinMind answered 402");

  tradingDays.mockRejectedValue(failure);

  expect(await days(atEight(Market.TW))).toBe(weekdays);
  expect(diagnostics.recovered).toHaveBeenCalledWith(
    failure,
    "schedules.trading-days",
    { "solyx.market": Market.TW }
  );
});
