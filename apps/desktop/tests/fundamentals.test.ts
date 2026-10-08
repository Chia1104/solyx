import { expect, test, vi } from "vite-plus/test";

import type { FundamentalsProvider } from "@solyx/core/fundamentals";
import { Market } from "@solyx/core/market";

import { createFundamentals } from "../src/main/modules/fundamentals/fundamentals.ts";

const TSMC = { market: Market.TW, symbol: "2330" };

const HOUR_MS = 60 * 60 * 1000;

function setup() {
  // 2026-10-07 10:00 in Taipei.
  const clock = { now: Date.parse("2026-10-07T02:00:00Z") };

  const provider = {
    id: "fake",
    markets: [Market.TW],
    getStatements: vi.fn<FundamentalsProvider["getStatements"]>(async () => []),
    getMonthlyRevenue: vi.fn<FundamentalsProvider["getMonthlyRevenue"]>(
      async () => []
    ),
    getDividends: vi.fn<FundamentalsProvider["getDividends"]>(async () => []),
  };

  const fundamentals = createFundamentals({
    providers: [provider],
    now: () => new Date(clock.now),
  });

  return { clock, provider, fundamentals };
}

test("asks the market's provider for five years of quarters and dividends and three of months", async () => {
  const { provider, fundamentals } = setup();

  await fundamentals.statements(TSMC);
  await fundamentals.monthlyRevenue(TSMC);
  await fundamentals.dividends(TSMC);

  expect(provider.getStatements).toHaveBeenCalledWith(TSMC, "2021-10-07");
  expect(provider.getMonthlyRevenue).toHaveBeenCalledWith(TSMC, "2023-10");
  expect(provider.getDividends).toHaveBeenCalledWith(TSMC, "2021-10-07");
});

test("keeps a listing's answer for half a day", async () => {
  const { clock, provider, fundamentals } = setup();

  await fundamentals.statements(TSMC);
  clock.now += 11 * HOUR_MS;
  await fundamentals.statements(TSMC);

  expect(provider.getStatements).toHaveBeenCalledTimes(1);

  clock.now += 2 * HOUR_MS;
  await fundamentals.statements(TSMC);

  expect(provider.getStatements).toHaveBeenCalledTimes(2);
});

test("asks again after a failure", async () => {
  const { provider, fundamentals } = setup();

  provider.getStatements.mockRejectedValueOnce(
    new Error("FinMind answered 402")
  );

  await expect(fundamentals.statements(TSMC)).rejects.toThrow("402");
  await fundamentals.statements(TSMC);

  expect(provider.getStatements).toHaveBeenCalledTimes(2);
});

test("a market no provider covers has no fundamentals", async () => {
  const { provider, fundamentals } = setup();

  expect(
    await fundamentals.statements({ market: Market.US, symbol: "AAPL" })
  ).toEqual([]);
  expect(provider.getStatements).not.toHaveBeenCalled();
});
