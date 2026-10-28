import { expect, test, vi } from "vite-plus/test";

import type { ExchangeRateProvider } from "@solyx/core/exchange-rate";
import type {
  MacroCalendarProvider,
  MacroFiguresProvider,
} from "@solyx/core/macro";
import { Market } from "@solyx/core/market";
import type { YieldCurveProvider } from "@solyx/core/yields";
import { HOUR_MS } from "@solyx/utils/date";
import { memoryAnswers } from "@solyx/utils/fresh";

import { createMacro } from "../src/modules/macro/macro.ts";

function setup() {
  // 2026-10-08 12:00 in Taipei.
  const clock = { now: Date.parse("2026-10-08T04:00:00Z") };

  const calendar = {
    id: "fake-calendar",
    markets: [Market.TW],
    releases: vi.fn<MacroCalendarProvider["releases"]>(async () => []),
  };

  const database = {
    id: "fake-database",
    markets: [Market.TW],
    series: vi.fn<MacroFiguresProvider["series"]>(async () => []),
  };

  const rates = {
    id: "fake-rates",
    latest: vi.fn<ExchangeRateProvider["latest"]>(async () => ({
      date: "2026-10-07",
      twdPerUsd: 32.4,
    })),
  };

  const treasury = {
    id: "fake-treasury",
    curves: vi.fn<YieldCurveProvider["curves"]>(async () => []),
  };

  const macro = createMacro({
    calendars: [calendar],
    figures: [database],
    exchangeRates: rates,
    yieldCurves: treasury,
    answers: memoryAnswers(),
    now: () => new Date(clock.now),
  });

  return { clock, calendar, database, rates, treasury, macro };
}

test("a market's schedule is read from a week back, so releases just out stay on it, and twice a day at most", async () => {
  const { clock, calendar, macro } = setup();

  await macro.schedule(Market.TW);

  expect(calendar.releases).toHaveBeenCalledExactlyOnceWith(
    Market.TW,
    "2026-10-01"
  );

  clock.now += 11 * HOUR_MS;
  await macro.schedule(Market.TW);

  expect(calendar.releases).toHaveBeenCalledTimes(1);

  clock.now += 2 * HOUR_MS;
  await macro.schedule(Market.TW);

  expect(calendar.releases).toHaveBeenCalledTimes(2);
});

test("a market's figures are read from twenty-six months back and once an hour at most", async () => {
  const { clock, database, macro } = setup();

  await macro.series(Market.TW);

  expect(database.series).toHaveBeenCalledExactlyOnceWith(Market.TW, "2024-08");

  clock.now += HOUR_MS - 1;
  await macro.series(Market.TW);

  expect(database.series).toHaveBeenCalledTimes(1);

  clock.now += 1;
  await macro.series(Market.TW);

  expect(database.series).toHaveBeenCalledTimes(2);
});

test("a market no source covers has neither a schedule nor figures, and costs no request", async () => {
  const { calendar, database, macro } = setup();

  expect(await macro.schedule(Market.US)).toEqual([]);
  expect(await macro.series(Market.US)).toEqual([]);
  expect(calendar.releases).not.toHaveBeenCalled();
  expect(database.series).not.toHaveBeenCalled();
});

test("a read that fails is asked again on the next call", async () => {
  const { database, macro } = setup();

  database.series.mockRejectedValueOnce(new Error("DGBAS answered 503"));

  await expect(macro.series(Market.TW)).rejects.toThrow("DGBAS answered 503");
  expect(await macro.series(Market.TW)).toEqual([]);
  expect(database.series).toHaveBeenCalledTimes(2);
});

test("the exchange rate is read every three hours at most, and the last one read stands while its source fails", async () => {
  const { clock, rates, macro } = setup();

  await expect(macro.exchangeRate()).resolves.toEqual({
    date: "2026-10-07",
    twdPerUsd: 32.4,
  });

  clock.now += 3 * HOUR_MS - 1;
  await macro.exchangeRate();

  expect(rates.latest).toHaveBeenCalledTimes(1);

  clock.now += 1;
  rates.latest.mockRejectedValueOnce(
    new Error("The central bank answered 503")
  );

  await expect(macro.exchangeRate()).resolves.toEqual({
    date: "2026-10-07",
    twdPerUsd: 32.4,
  });

  expect(rates.latest).toHaveBeenCalledTimes(2);
});

test("the yield curve is read from about three months back on New York's calendar, once an hour at most", async () => {
  const { clock, treasury, macro } = setup();

  await macro.yields();

  expect(treasury.curves).toHaveBeenCalledExactlyOnceWith("2026-07-08");

  clock.now += HOUR_MS - 1;
  await macro.yields();

  expect(treasury.curves).toHaveBeenCalledTimes(1);
});
