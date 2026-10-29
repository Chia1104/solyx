import { expect, test, vi } from "vite-plus/test";

import type { Candle } from "@solyx/core/candles";
import { Market } from "@solyx/core/market";
import type { TotalReturnProvider } from "@solyx/core/market-data";
import { HOUR_MS } from "@solyx/utils/date";
import { memoryAnswers } from "@solyx/utils/fresh";

import {
  createMarketReturns,
  fundTotalReturn,
} from "../src/modules/market/market-returns.ts";

const SPY = { market: Market.US, symbol: "SPY" };

function setup() {
  // 2026-10-07 10:00 in Taipei.
  const clock = { now: Date.parse("2026-10-07T02:00:00Z") };

  const provider = {
    id: "fake",
    markets: [Market.TW],
    getTotalReturn: vi.fn<TotalReturnProvider["getTotalReturn"]>(async () => [
      { date: "2026-10-06", close: 100_000 },
    ]),
  };

  const returns = createMarketReturns({
    providers: [provider],
    answers: memoryAnswers(),
    now: () => new Date(clock.now),
  });

  return { clock, provider, returns };
}

test("asks the market's provider for its index over the daily bars' lookback, and keeps the answer twelve hours", async () => {
  const { clock, provider, returns } = setup();

  expect(await returns.closes(Market.TW)).toEqual([
    { date: "2026-10-06", close: 100_000 },
  ]);
  expect(provider.getTotalReturn).toHaveBeenCalledWith(Market.TW, "2024-10-07");

  clock.now += 11 * HOUR_MS;
  await returns.closes(Market.TW);

  expect(provider.getTotalReturn).toHaveBeenCalledOnce();

  clock.now += 2 * HOUR_MS;
  await returns.closes(Market.TW);

  expect(provider.getTotalReturn).toHaveBeenCalledTimes(2);
});

test("a market no provider covers has no index to read", async () => {
  const { returns } = setup();

  await expect(returns.closes(Market.US)).rejects.toThrow(
    "No source covers the US index on total return"
  );
});

test("a fund stands for its index on its own bars, carried over what it paid out", async () => {
  const bar = (day: string, close: number, reference?: number): Candle => {
    const candle: Candle = {
      time: Date.parse(`${day}T00:00:00-04:00`) / 1000,
      open: close,
      high: close,
      low: close,
      close,
      volume: 1,
    };

    if (reference !== undefined) candle.reference = reference;

    return candle;
  };

  const candles = vi.fn(async () => [
    bar("2026-09-18", 600),
    // 2 went ex on the 21st.
    bar("2026-09-21", 603, 598),
    bar("2026-09-22", 604, 603),
  ]);

  const fund = fundTotalReturn({ candles }, SPY);

  const closes = await fund.getTotalReturn(Market.US, "2026-09-21");

  expect(closes.map(({ date }) => date)).toEqual(["2026-09-21", "2026-09-22"]);
  // Each on the first bar's terms, so 603 a share after the payout stands for 603 / (598 / 600).
  expect(closes[0].close).toBeCloseTo((603 * 600) / 598);
  expect(closes[1].close / closes[0].close).toBeCloseTo(604 / 603);
  expect(await fund.getTotalReturn(Market.TW, "2026-09-21")).toEqual([]);
  expect(candles).toHaveBeenCalledOnce();
});
