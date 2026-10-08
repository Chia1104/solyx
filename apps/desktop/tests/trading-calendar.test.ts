import { expect, test, vi } from "vite-plus/test";

import { Market } from "@solyx/core/market";
import type { TradingCalendarProvider } from "@solyx/core/session";

import { createTradingCalendar } from "../src/main/modules/market/trading-calendar.ts";

const HOUR_MS = 60 * 60 * 1000;

function setup() {
  // 2026-10-07 10:00 in Taipei.
  const clock = { now: Date.parse("2026-10-07T02:00:00Z") };

  const provider = {
    markets: [Market.TW],
    // Friday 2026-10-09 is a holiday.
    tradingDays: vi.fn<TradingCalendarProvider["tradingDays"]>(async () => [
      "2026-10-07",
      "2026-10-08",
      "2026-10-12",
    ]),
  };

  const tradingDays = createTradingCalendar({
    providers: [provider],
    now: () => new Date(clock.now),
  });

  return { clock, provider, tradingDays };
}

test("reads a market's days from a year back and keeps them for the exchange's day", async () => {
  const { clock, provider, tradingDays } = setup();

  const trades = await tradingDays(Market.TW);

  expect(provider.tradingDays).toHaveBeenCalledWith(Market.TW, "2025-10-07");
  expect(trades("2026-10-08")).toBe(true);
  expect(trades("2026-10-09")).toBe(false);

  clock.now += 13 * HOUR_MS;
  await tradingDays(Market.TW);

  expect(provider.tradingDays).toHaveBeenCalledTimes(1);

  // Past midnight in Taipei.
  clock.now += 2 * HOUR_MS;
  await tradingDays(Market.TW);

  expect(provider.tradingDays).toHaveBeenCalledTimes(2);
});

test("asks again after a failure", async () => {
  const { provider, tradingDays } = setup();

  provider.tradingDays.mockRejectedValueOnce(new Error("FinMind answered 402"));

  await expect(tradingDays(Market.TW)).rejects.toThrow("402");
  await tradingDays(Market.TW);

  expect(provider.tradingDays).toHaveBeenCalledTimes(2);
});

test("a market no provider covers trades every weekday", async () => {
  const { provider, tradingDays } = setup();

  const trades = await tradingDays(Market.US);

  expect(trades("2026-10-09")).toBe(true);
  expect(trades("2026-10-10")).toBe(false);
  expect(provider.tradingDays).not.toHaveBeenCalled();
});
