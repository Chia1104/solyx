import { expect, test, vi } from "vite-plus/test";

import { Market } from "@solyx/core/market";
import { Session, weekdays } from "@solyx/core/session";
import type { TradingCalendarProvider } from "@solyx/core/session";
import { HOUR_MS } from "@solyx/utils/date";
import { memoryAnswers } from "@solyx/utils/fresh";

import {
  createMarketDays,
  createTradingCalendar,
  marketSessions,
} from "../src/modules/market/trading-calendar.ts";

function setup() {
  // 2026-10-07 10:00 in Taipei.
  const clock = { now: Date.parse("2026-10-07T02:00:00Z") };

  const provider = {
    markets: [Market.TW],
    // Friday 2026-10-09 is a holiday.
    tradingDays: vi.fn<TradingCalendarProvider["tradingDays"]>(async () => ({
      trading: ["2026-10-07", "2026-10-08", "2026-10-12"],
      earlyCloses: [],
    })),
  };

  const tradingDays = createTradingCalendar({
    providers: [provider],
    answers: memoryAnswers(),
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

test("a market's days come from its calendar, and a market no provider covers trades every weekday", async () => {
  const { tradingDays } = setup();
  const diagnostics = { recovered: vi.fn() };
  const days = createMarketDays({ tradingDays, diagnostics });

  expect((await days(Market.TW))("2026-10-09")).toBe(false);
  expect(await days(Market.US)).toBe(weekdays);
  expect(diagnostics.recovered).not.toHaveBeenCalled();
});

test("a market reads as closed all day on a day its exchange does not trade", async () => {
  const { tradingDays } = setup();

  const days = createMarketDays({
    tradingDays,
    diagnostics: { recovered: vi.fn() },
  });

  // 10:00 in Taipei on Thursday, a session, and on Friday, a holiday.
  expect(await marketSessions(days, new Date("2026-10-08T02:00:00Z"))).toEqual({
    [Market.TW]: Session.Regular,
    [Market.US]: Session.Closed,
  });
  expect(
    (await marketSessions(days, new Date("2026-10-09T02:00:00Z")))[Market.TW]
  ).toBe(Session.Closed);
});

test("a calendar that cannot be read leaves every weekday a session, and says so in the log", async () => {
  const { provider, tradingDays } = setup();
  const diagnostics = { recovered: vi.fn() };
  const days = createMarketDays({ tradingDays, diagnostics });
  const failure = new Error("FinMind answered 402");

  provider.tradingDays.mockRejectedValue(failure);

  expect(await days(Market.TW)).toBe(weekdays);
  expect(diagnostics.recovered).toHaveBeenCalledWith(
    failure,
    "market.trading-days",
    { "solyx.market": Market.TW }
  );
});
