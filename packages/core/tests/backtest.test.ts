import { describe, expect, test } from "vite-plus/test";

import { backtest, defaultCosts } from "../src/backtest.ts";
import type { RuleStrategy } from "../src/backtest.ts";
import type { Candle } from "../src/candles.ts";
import { Market } from "../src/market.ts";

const TSMC = { market: Market.TW, symbol: "2330" };

/** Daily bars from 2026-01-05 on, one a weekday, each opening at the close before unless told otherwise. */
function bars(
  closes: readonly number[],
  override: (index: number) => Partial<Candle> = () => ({})
): Candle[] {
  let day = Temporal.PlainDate.from("2026-01-05");

  return closes.map((close, index) => {
    while (day.dayOfWeek > 5) day = day.add({ days: 1 });

    const open = index === 0 ? close : closes[index - 1];

    const bar = {
      time: day.toZonedDateTime("Asia/Taipei").epochMilliseconds / 1000,
      open,
      high: Math.max(open, close),
      low: Math.min(open, close),
      close,
      volume: 1000,
      ...override(index),
    };

    day = day.add({ days: 1 });

    return bar;
  });
}

const NO_COSTS = {
  commissionRate: 0,
  minCommission: 0,
  sellTaxRate: 0,
  slippageTicks: 0,
};

// Buys once the close rises past 100, sells once it falls back under it.
const THRESHOLD: RuleStrategy = {
  entry: { crossesAbove: [{ price: "close" }, { value: 100 }] },
  exit: { crossesBelow: [{ price: "close" }, { value: 100 }] },
};

test("a rule read at a bar's close fills at the next bar's open, never at a price it could not have known", () => {
  const result = backtest(TSMC, bars([95, 98, 102, 110, 99, 97]), THRESHOLD, {
    capital: 10_200,
    costs: NO_COSTS,
  });

  // The close of 102 on the third bar buys at the fourth's open, 102; the close of 99 sells at the sixth's open, 99.
  expect(result.trades).toEqual([
    {
      entryDate: "2026-01-08",
      entryPrice: 102,
      exitDate: "2026-01-12",
      exitPrice: 99,
      shares: 100,
      profit: -300,
      return: -300 / 10_200,
      bars: 2,
    },
  ]);
  expect(result.equity.map(({ value }) => value)).toEqual([
    10_200, 10_200, 10_200, 11_000, 9_900, 9_900,
  ]);
  expect(result.all).toMatchObject({
    from: "2026-01-05",
    to: "2026-01-12",
    totalReturn: -300 / 10_200,
    annualReturn: null,
    trades: 1,
    winRate: 0,
    payoffRatio: null,
    exposure: 2 / 6,
  });
  expect(result.all.maxDrawdown).toBeCloseTo(1 - 9_900 / 11_000);
});

test("a Taiwan trade pays the broker's commission, at least its minimum, the tax on the sale and a tick each way", () => {
  expect(defaultCosts(TSMC)).toEqual({
    commissionRate: 0.001425,
    minCommission: 20,
    sellTaxRate: 0.003,
    slippageTicks: 1,
  });
  expect(defaultCosts({ market: Market.TW, symbol: "0050" }).sellTaxRate).toBe(
    0.001
  );

  const result = backtest(
    TSMC,
    bars([95, 98, 102, 110, 120, 99, 97]),
    THRESHOLD,
    {
      capital: 20_000,
    }
  );

  const [trade] = result.trades;

  // Bought at 102 plus its tick of 0.5, and sold at 99 less its tick of 0.1; 20,000 buys 194 shares with the commission.
  expect(trade).toMatchObject({
    entryPrice: 102.5,
    exitPrice: 98.9,
    shares: 194,
  });

  const bought = 102.5 * 194;
  const sold = 98.9 * 194;

  expect(trade.profit).toBeCloseTo(
    sold -
      Math.max(sold * 0.001425, 20) -
      sold * 0.003 -
      (bought + Math.max(bought * 0.001425, 20))
  );
});

test("a stop sells once a close falls past it, and a position held at the end counts in no record", () => {
  const strategy: RuleStrategy = {
    entry: { crossesAbove: [{ price: "close" }, { value: 100 }] },
    exit: { below: [{ price: "close" }, { value: 0 }] },
    stopLoss: 0.05,
  };

  const result = backtest(
    TSMC,
    bars([95, 102, 103, 97, 96, 101, 104]),
    strategy,
    {
      capital: 10_000,
      costs: NO_COSTS,
    }
  );

  expect(
    result.trades.map(({ entryDate, exitDate }) => [entryDate, exitDate])
  ).toEqual([
    // Bought at 102; the close of 97 is not yet 5% down, that of 96 is, so it sells at the next open.
    ["2026-01-07", "2026-01-12"],
    // Bought again after the close of 101, and still held.
    ["2026-01-13", null],
  ]);
  expect(result.all.trades).toBe(1);
});

test("a Taiwan bar locked at its limit fills no buy, and the rule is read again at its close", () => {
  // The fourth bar opens and closes at 112.2, up its limit, so the buy waits for the fifth.
  const result = backtest(
    TSMC,
    bars([95, 98, 102, 112.2, 115, 116], (index) =>
      index === 3 ? { open: 112.2, high: 112.2, low: 112.2 } : {}
    ),
    { ...THRESHOLD, entry: { above: [{ price: "close" }, { value: 100 }] } },
    { capital: 20_000, costs: NO_COSTS }
  );

  expect(result.trades[0]).toMatchObject({
    entryDate: "2026-01-09",
    entryPrice: 112.2,
  });
});

describe("indicators and stretches", () => {
  // Twenty bars down, then twenty up.
  const closes = [
    ...Array.from({ length: 20 }, (_, index) => 120 - index),
    ...Array.from({ length: 20 }, (_, index) => 101 + index),
  ];

  const crossing: RuleStrategy = {
    entry: { crossesAbove: [{ sma: 3 }, { sma: 10 }] },
    exit: { crossesBelow: [{ sma: 3 }, { sma: 10 }] },
  };

  test("an indicator is read only once it has the bars it needs", () => {
    const result = backtest(TSMC, bars(closes), crossing, {
      capital: 100_000,
      costs: NO_COSTS,
    });

    expect(result.trades).toHaveLength(1);
    expect(result.trades[0].exitDate).toBeNull();
    expect(result.trades[0].entryDate > "2026-02-02").toBe(true);
  });

  test("a split measures the stretch before it apart from the one after", () => {
    const result = backtest(TSMC, bars(closes), crossing, {
      capital: 100_000,
      costs: NO_COSTS,
      split: "2026-02-02",
    });

    expect(result.inSample).toMatchObject({
      from: "2026-01-05",
      to: "2026-01-30",
      exposure: 0,
      totalReturn: 0,
    });
    expect(result.outOfSample?.from).toBe("2026-02-02");
    expect(result.outOfSample?.totalReturn).toBeGreaterThan(0);
    expect(result.all.buyAndHold).toBeCloseTo(120 / 120 - 1);
  });

  test("a breakout reads the highest high of the bars before this one", () => {
    const result = backtest(
      TSMC,
      bars(closes),
      {
        entry: { above: [{ price: "close" }, { highest: 5 }] },
        exit: { below: [{ price: "close" }, { lowest: 5 }] },
      },
      { capital: 100_000, costs: NO_COSTS }
    );

    expect(result.trades[0].entryDate > "2026-02-02").toBe(true);
  });
});
