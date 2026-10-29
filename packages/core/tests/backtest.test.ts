import { median, percentile } from "es-toolkit";
import { describe, expect, test, vi } from "vite-plus/test";

import { kernel } from "@solyx/kernel/kernel";

import {
  BACKTEST_PERMUTATIONS,
  ENOUGH_TRADES,
  MAX_LINE_VALUES,
  MAX_SCAN_SERIES,
  MAX_WALK_WINDOWS,
  backtest,
  backtestBars,
  defaultCosts,
  MAX_RULE_BRANCHES,
  MAX_RULE_COMPARISONS,
  MAX_RULE_DEPTH,
  MAX_RULE_SERIES,
  rollingBacktest,
  ruleSignal,
  ruleStrategySchema,
  scanBacktests,
  strategyBars,
  walkForward,
} from "../src/backtest.ts";
import type {
  BacktestResult,
  RuleCondition,
  RuleSeries,
  RuleStrategy,
} from "../src/backtest.ts";
import { Interval, candleDate } from "../src/candles.ts";
import type { Candle } from "../src/candles.ts";
import type { Dividend } from "../src/fundamentals.ts";
import { sma } from "../src/indicators.ts";
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

/** Cash of `cash` a share, going ex on `cashExDate`. */
const dividend = (cashExDate: string, cash: number): Dividend => ({
  period: "2025",
  announced: null,
  cash,
  stock: 0,
  cashExDate,
  cashPaidOn: null,
  stockExDate: null,
});

// Buys once the close rises past 100, sells once it falls back under it.
const THRESHOLD: RuleStrategy = {
  entry: { crossesAbove: [{ price: "close" }, { value: 100 }] },
  exit: { crossesBelow: [{ price: "close" }, { value: 100 }] },
};

test("a rule read at a bar's close fills at the next bar's open, never at a price it could not have known", async () => {
  const result = await backtest(
    kernel,
    TSMC,
    bars([95, 98, 102, 110, 99, 97]),
    THRESHOLD,
    {
      capital: 10_200,
      costs: NO_COSTS,
    }
  );

  // The close of 102 on the third bar buys at the fourth's open, 102; the close of 99 sells at the sixth's open, 99.
  expect(result.trades).toEqual([
    {
      entryTime: "2026-01-08",
      entryPrice: 102,
      exitTime: "2026-01-12",
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

test("a Taiwan trade pays the broker's commission, at least its minimum, the tax on the sale and a tick each way", async () => {
  expect(defaultCosts(TSMC)).toEqual({
    commissionRate: 0.001425,
    minCommission: 20,
    sellTaxRate: 0.003,
    dividendTaxRate: 0,
    slippageTicks: 1,
  });
  expect(defaultCosts({ market: Market.TW, symbol: "0050" }).sellTaxRate).toBe(
    0.001
  );

  const result = await backtest(
    kernel,
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

test("a US trade pays no commission, the SEC's fee on a sale and a tick each way, and a Taiwan resident's tax is withheld from its dividends", () => {
  expect(defaultCosts({ market: Market.US, symbol: "AAPL" })).toEqual({
    commissionRate: 0,
    minCommission: 0,
    sellTaxRate: 0.0000206,
    dividendTaxRate: 0.3,
    slippageTicks: 1,
  });
});

test("a stop sells once a close falls past it, and a position held at the end counts in no record", async () => {
  const strategy: RuleStrategy = {
    entry: { crossesAbove: [{ price: "close" }, { value: 100 }] },
    exit: { below: [{ price: "close" }, { value: 0 }] },
    stopLoss: 0.05,
  };

  const result = await backtest(
    kernel,
    TSMC,
    bars([95, 102, 103, 97, 96, 101, 104]),
    strategy,
    {
      capital: 10_000,
      costs: NO_COSTS,
    }
  );

  expect(
    result.trades.map(({ entryTime, exitTime }) => [entryTime, exitTime])
  ).toEqual([
    // Bought at 102; the close of 97 is not yet 5% down, that of 96 is, so it sells at the next open.
    ["2026-01-07", "2026-01-12"],
    // Bought again after the close of 101, and still held.
    ["2026-01-13", null],
  ]);
  expect(result.all.trades).toBe(1);
});

test("a Taiwan bar locked at its limit fills no buy, and the rule is read again at its close", async () => {
  // The fourth bar opens and closes at 112.2, up its limit, so the buy waits for the fifth.
  const result = await backtest(
    kernel,
    TSMC,
    bars([95, 98, 102, 112.2, 115, 116], (index) =>
      index === 3 ? { open: 112.2, high: 112.2, low: 112.2 } : {}
    ),
    { ...THRESHOLD, entry: { above: [{ price: "close" }, { value: 100 }] } },
    { capital: 20_000, costs: NO_COSTS }
  );

  expect(result.trades[0]).toMatchObject({
    entryTime: "2026-01-09",
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

  test("an indicator is read only once it has the bars it needs", async () => {
    const result = await backtest(kernel, TSMC, bars(closes), crossing, {
      capital: 100_000,
      costs: NO_COSTS,
    });

    expect(result.trades).toHaveLength(1);
    expect(result.trades[0].exitTime).toBeNull();
    expect(result.trades[0].entryTime > "2026-02-02").toBe(true);
  });

  test("a split measures the stretch before it apart from the one after", async () => {
    const result = await backtest(kernel, TSMC, bars(closes), crossing, {
      capital: 100_000,
      costs: NO_COSTS,
      split: { day: "2026-02-02" },
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

  test("a breakout reads the highest high of the bars before this one", async () => {
    const result = await backtest(
      kernel,
      TSMC,
      bars(closes),
      {
        entry: { above: [{ price: "close" }, { highest: 5 }] },
        exit: { below: [{ price: "close" }, { lowest: 5 }] },
      },
      { capital: 100_000, costs: NO_COSTS }
    );

    expect(result.trades[0].entryTime > "2026-02-02").toBe(true);
  });
});

test("a buy takes the most shares the cash covers with the minimum commission, rather than none", async () => {
  // 1,010 buys ten shares at 100 before the commission, but the minimum of 20 leaves room for nine.
  const result = await backtest(
    kernel,
    TSMC,
    bars([98, 102, 103], (index) =>
      index === 2 ? { open: 100, low: 100 } : {}
    ),
    {
      entry: { above: [{ price: "close" }, { value: 101 }] },
      exit: { below: [{ price: "close" }, { value: 0 }] },
    },
    { capital: 1_010, costs: { ...defaultCosts(TSMC), slippageTicks: 0 } }
  );

  expect(result.trades[0]).toMatchObject({ entryPrice: 100, shares: 9 });
});

test("buying and holding a stretch starts from the close its return is measured from", async () => {
  // Held from the second bar on; the split falls on the bar that doubled.
  const result = await backtest(
    kernel,
    TSMC,
    bars([100, 100, 100, 200, 200]),
    {
      entry: { above: [{ price: "close" }, { value: 0 }] },
      exit: { below: [{ price: "close" }, { value: 0 }] },
    },
    { capital: 100_000, costs: NO_COSTS, split: { day: "2026-01-08" } }
  );

  expect(result.outOfSample?.totalReturn).toBeCloseTo(1);
  expect(result.outOfSample?.buyAndHold).toBeCloseTo(1);
});

test("buying and holding's drawdown is its deepest fall from a high, from the close its stretch is measured from", async () => {
  const result = await backtest(
    kernel,
    TSMC,
    bars([100, 120, 130, 110, 80]),
    {
      entry: { above: [{ price: "close" }, { value: 1000 }] },
      exit: { below: [{ price: "close" }, { value: 0 }] },
    },
    { capital: 100_000, costs: NO_COSTS, split: { day: "2026-01-08" } }
  );

  // The stretch from the fourth bar is measured from the close of 130, its high.
  expect(result.all.buyAndHoldDrawdown).toBeCloseTo(1 - 80 / 130);
  expect(result.inSample?.buyAndHoldDrawdown).toBe(0);
  expect(result.outOfSample?.buyAndHoldDrawdown).toBeCloseTo(1 - 80 / 130);
  // Holding nothing loses nothing.
  expect(result.all.maxDrawdown).toBe(0);
  expect(result.holding.map(({ value }) => value)).toEqual(
    [100, 120, 130, 110, 80].map((close) => close * 1000)
  );
});

test("holding's curve reads a split as no move, as its return does", async () => {
  // Split one to four on the fourth bar.
  const result = await backtest(
    kernel,
    TSMC,
    bars([100, 100, 100, 25, 26], (index) =>
      index === 3 ? { open: 25, high: 25.5, low: 25, reference: 25 } : {}
    ),
    {
      entry: { above: [{ price: "close" }, { value: 1000 }] },
      exit: { below: [{ price: "close" }, { value: 0 }] },
    },
    { capital: 10_000, costs: NO_COSTS }
  );

  expect(result.holding.map(({ value }) => value)).toEqual([
    10_000, 10_000, 10_000, 10_000, 10_400,
  ]);
  expect(result.holding.at(-1)?.value).toBeCloseTo(
    10_000 * (1 + result.all.buyAndHold)
  );
});

describe("splits and what went ex", () => {
  // Bought at the second bar's open and never sold.
  const holding: RuleStrategy = {
    entry: { above: [{ price: "close" }, { value: 0 }] },
    exit: { below: [{ price: "close" }, { value: 0 }] },
    stopLoss: 0.1,
  };

  test("a split while held reads as no move: the stop holds, and the holding carries over", async () => {
    // Split one to four on the fourth bar.
    const result = await backtest(
      kernel,
      TSMC,
      bars([100, 100, 100, 25, 26], (index) =>
        index === 3 ? { open: 25, high: 25.5, low: 25, reference: 25 } : {}
      ),
      holding,
      { capital: 10_000, costs: NO_COSTS }
    );

    expect(result.trades).toEqual([
      {
        entryTime: "2026-01-06",
        entryPrice: 100,
        exitTime: null,
        exitPrice: 26,
        shares: 100,
        profit: 400,
        return: 0.04,
        bars: 3,
      },
    ]);
    expect(result.equity.map(({ value }) => value)).toEqual([
      10_000, 10_000, 10_000, 10_000, 10_400,
    ]);
    expect(result.all.maxDrawdown).toBe(0);
    expect(result.all.buyAndHold).toBeCloseTo(0.04);
    expect(result.all.buyAndHoldDrawdown).toBe(0);
  });

  test("what went ex while held is bought back in at the reference", async () => {
    // Went ex of 4 on the fourth bar.
    const result = await backtest(
      kernel,
      TSMC,
      bars([100, 100, 100, 96, 97], (index) =>
        index === 3 ? { open: 96, low: 96, reference: 96 } : {}
      ),
      holding,
      { capital: 10_000, costs: NO_COSTS }
    );

    expect(result.equity.map(({ value }) => value)).toEqual([
      10_000,
      10_000,
      10_000,
      expect.closeTo(10_000),
      expect.closeTo((10_000 / 96) * 97),
    ]);
    expect(result.all.totalReturn).toBeCloseTo(97 / 96 - 1);
    expect(result.all.buyAndHold).toBeCloseTo(97 / 96 - 1);
  });

  // Went ex of 4 on the fourth bar, 2026-01-08, of which 30% is withheld.
  const wentEx = bars([100, 100, 100, 96, 97], (index) =>
    index === 3 ? { open: 96, low: 96, reference: 96 } : {}
  );

  const WITHHELD = { ...NO_COSTS, dividendTaxRate: 0.3 };

  test("the tax withheld from what went ex while held is not bought back in, and holding pays it too", async () => {
    const result = await backtest(kernel, TSMC, wentEx, holding, {
      capital: 10_000,
      costs: WITHHELD,
      dividends: [dividend("2026-01-08", 4)],
    });

    const kept = 100 - 4 * 0.3;

    expect(result.equity.map(({ value }) => value)).toEqual([
      10_000,
      10_000,
      10_000,
      expect.closeTo(100 * kept),
      expect.closeTo(((100 * kept) / 96) * 97),
    ]);
    expect(result.all.totalReturn).toBeCloseTo((kept / 96) * (97 / 100) - 1);
    expect(result.all.buyAndHold).toBeCloseTo(result.all.totalReturn);
    expect(result.holding.at(-1)?.value).toBeCloseTo(
      result.equity.at(-1)?.value ?? 0
    );
    expect(result.costs.dividendTaxRate).toBe(0.3);
  });

  test("tax is withheld from no more cash than the reference made up for", async () => {
    // The reference made up for 2 of the 4 that went ex, and nothing went ex on the last bar.
    const result = await backtest(
      kernel,
      TSMC,
      bars([100, 100, 100, 98, 99], (index) =>
        index === 3 ? { open: 98, low: 98, reference: 98 } : {}
      ),
      holding,
      {
        capital: 10_000,
        costs: WITHHELD,
        dividends: [dividend("2026-01-08", 4), dividend("2026-01-09", 1)],
      }
    );

    expect(result.all.totalReturn).toBeCloseTo(
      ((100 - 2 * 0.3) / 98) * (99 / 100) - 1
    );
  });

  test("a run that withholds tax from dividends fails without the listing's distributions", async () => {
    await expect(
      backtest(kernel, TSMC, wentEx, holding, { costs: WITHHELD })
    ).rejects.toThrow("needs its distributions");
  });

  test("a rule against a price reads it as traded, whatever later bars went ex of", async () => {
    const strategy: RuleStrategy = {
      entry: { crossesAbove: [{ price: "close" }, { value: 100 }] },
      exit: { below: [{ price: "close" }, { value: 0 }] },
    };

    const closes = [98, 101, 103, 104, 52];

    const asTraded = await backtest(kernel, TSMC, bars(closes), strategy, {
      capital: 10_000,
      costs: NO_COSTS,
    });

    // Split one to two on the last bar, after the cross.
    const split = await backtest(
      kernel,
      TSMC,
      bars(closes, (index) =>
        index === 4 ? { open: 52, high: 52, low: 51, reference: 52 } : {}
      ),
      strategy,
      { capital: 10_000, costs: NO_COSTS }
    );

    expect(split.trades[0].entryTime).toBe(asTraded.trades[0].entryTime);
  });

  test("a bar locked at its limit is read against its reference", async () => {
    // Went ex of 12 on the fourth bar and locked up at 99, its limit from 90 though under the close before.
    const result = await backtest(
      kernel,
      TSMC,
      bars([95, 98, 102, 99, 100], (index) =>
        index === 3 ? { open: 99, high: 99, low: 99, reference: 90 } : {}
      ),
      {
        entry: { above: [{ price: "close" }, { value: 98.5 }] },
        exit: { below: [{ price: "close" }, { value: 0 }] },
      },
      { capital: 10_000, costs: NO_COSTS }
    );

    // The third close buys; the locked fourth bar fills nothing, and its close buys again at the fifth's open.
    expect(result.trades[0]).toMatchObject({
      entryTime: "2026-01-09",
      entryPrice: 99,
    });
  });
});

/** Taiwan daily bars of a seeded walk from 100, with a day locked up, a split and what went ex now and then. */
function walk(seed: number, length: number): Candle[] {
  let state = seed;

  const random = () => {
    state = (state * 1_664_525 + 1_013_904_223) % 2 ** 32;

    return state / 2 ** 32;
  };

  const tick = (price: number) => Math.max(Math.round(price * 20) / 20, 0.05);
  let close = 100;

  return bars(Array.from({ length }, () => 0)).map((bar) => {
    const draw = random();
    const event = draw < 0.01 ? 0.5 : draw < 0.04 ? 0.97 : 1;
    const reference = tick(close * event);
    const move = (random() + random() + random() - 1.5) * 0.03;
    const lockedUp = random() < 0.01;
    const next = tick(reference * (lockedUp ? 1.1 : 1 + move));
    const open = lockedUp ? next : tick(reference * (1 + move / 3));

    close = next;

    return {
      ...bar,
      open,
      high: lockedUp
        ? next
        : tick(Math.max(open, next) * (1 + random() * 0.01)),
      low: lockedUp ? next : tick(Math.min(open, next) * (1 - random() * 0.01)),
      close: next,
      reference,
    };
  });
}

describe("no rule sees a later price", () => {
  const strategies: RuleStrategy[] = [
    {
      entry: { crossesAbove: [{ sma: 5 }, { sma: 20 }] },
      exit: { crossesBelow: [{ sma: 5 }, { sma: 20 }] },
    },
    {
      entry: { above: [{ price: "close" }, { highest: 20 }] },
      exit: { below: [{ price: "close" }, { lowest: 10 }] },
      takeProfit: 0.15,
    },
    {
      entry: {
        all: [
          { crossesAbove: [{ price: "close" }, { value: 100 }] },
          { below: [{ rsi: 14 }, { value: 70 }] },
        ],
      },
      exit: { crossesBelow: [{ ema: 12 }, { bollinger: 20, band: "middle" }] },
      stopLoss: 0.05,
    },
  ];

  const filled = (result: BacktestResult, through: string) =>
    result.trades
      .filter(({ entryTime }) => entryTime <= through)
      .map((trade) => ({
        entryTime: trade.entryTime,
        entryPrice: trade.entryPrice,
        shares: trade.shares,
        exit:
          trade.exitTime !== null && trade.exitTime <= through
            ? [trade.exitTime, trade.exitPrice]
            : null,
      }));

  test("a run cut short agrees with the whole run up to the cut", async () => {
    for (let seed = 1; seed <= 8; seed++) {
      const whole = walk(seed, 300);

      for (const strategy of strategies) {
        const result = await backtest(kernel, TSMC, whole, strategy);

        for (const cut of [40, 120, 210, 290]) {
          const short = await backtest(
            kernel,
            TSMC,
            whole.slice(0, cut + 1),
            strategy
          );

          const day = result.equity[cut].date;

          expect(short.equity).toEqual(result.equity.slice(0, cut + 1));
          expect(filled(short, day)).toEqual(filled(result, day));
        }
      }
    }
  });

  test("rewriting the bars after one, the next one's open kept, changes no fill up to that open", async () => {
    for (let seed = 1; seed <= 8; seed++) {
      const whole = walk(seed, 300);
      const other = walk(seed + 100, 300);

      for (const strategy of strategies) {
        const result = await backtest(kernel, TSMC, whole, strategy);

        for (let cut = 30; cut < 298; cut += 11) {
          const next = whole[cut + 1];

          // A bar locked at its limit fills nothing, which the bar itself decides.
          if (next.high === next.low) continue;

          const rewritten = [
            ...whole.slice(0, cut + 1),
            {
              ...next,
              high: next.open + 1,
              low: next.open - 1,
              close: next.open + 0.5,
            },
            ...other.slice(cut + 2).map((bar, index) => ({
              ...bar,
              time: whole[cut + 2 + index].time,
            })),
          ];

          const day = result.equity[cut + 1].date;

          expect(
            filled(await backtest(kernel, TSMC, rewritten, strategy), day)
          ).toEqual(filled(result, day));
        }
      }
    }
  });
});

describe("bars shorter than a day", () => {
  /** Minute bars from 09:00, a session a weekday from 2026-01-05 on, each opening at the close before unless told otherwise. */
  function minutes(
    sessions: readonly (readonly number[])[],
    override: (session: number, index: number) => Partial<Candle> = () => ({})
  ): Candle[] {
    let day = Temporal.PlainDate.from("2026-01-05");
    let before: number | undefined;

    return sessions.flatMap((closes, session) => {
      while (day.dayOfWeek > 5) day = day.add({ days: 1 });

      const opening = day.toZonedDateTime({
        timeZone: "Asia/Taipei",
        plainTime: "09:00",
      });

      day = day.add({ days: 1 });

      return closes.map((close, index) => {
        const open = before ?? close;

        before = close;

        return {
          time: opening.add({ minutes: index }).epochMilliseconds / 1000,
          open,
          high: Math.max(open, close),
          low: Math.min(open, close),
          close,
          volume: 1000,
          ...override(session, index),
        };
      });
    });
  }

  /** Those sessions' daily bars, each moving from the close before unless `reference` gives another. */
  const daily = (
    sessions: readonly (readonly number[])[],
    reference: (session: number) => number | undefined = () => undefined
  ) => {
    const closes = sessions.map((closes) => closes[closes.length - 1]);

    return bars(closes, (index) =>
      index === 0 ? {} : { reference: reference(index) ?? closes[index - 1] }
    );
  };

  const MINUTE = {
    interval: Interval.OneMinute,
    capital: 10_000,
    costs: NO_COSTS,
  };

  const above = (value: number): RuleStrategy => ({
    entry: { above: [{ price: "close" }, { value }] },
    exit: { below: [{ price: "close" }, { value: 0 }] },
  });

  test("a rule read at a session's last close fills at the next session's first open", async () => {
    const sessions = [
      [99, 99, 101],
      [104, 105],
    ];

    const result = await backtest(
      kernel,
      TSMC,
      minutes(sessions, (session, index) =>
        session === 1 && index === 0 ? { open: 103 } : {}
      ),
      THRESHOLD,
      { ...MINUTE, daily: daily(sessions) }
    );

    expect(result.trades[0]).toMatchObject({
      entryTime: "2026-01-06 09:00",
      entryPrice: 103,
    });
  });

  test("a minute that traded at one price fills, unless that price is its session's limit", async () => {
    const flat = (price: number) => ({
      open: price,
      high: price,
      low: price,
      close: price,
    });

    // From the close of 100 the second session's limit up is 110.
    const locked = [[100], [101, 110, 109]];

    const atLimit = await backtest(
      kernel,
      TSMC,
      minutes(locked, (session, index) =>
        session === 1 && index === 1
          ? flat(110)
          : session === 1 && index === 2
            ? { open: 109.5 }
            : {}
      ),
      above(100.5),
      { ...MINUTE, daily: daily(locked) }
    );

    expect(atLimit.trades[0]).toMatchObject({
      entryTime: "2026-01-06 09:02",
      entryPrice: 109.5,
    });

    // A quiet minute above the one before it, as a daily bar locked up would read.
    const quiet = [[100], [101, 105, 106]];

    const belowLimit = await backtest(
      kernel,
      TSMC,
      minutes(quiet, (session, index) =>
        session === 1 && index === 1 ? flat(105) : {}
      ),
      above(100.5),
      { ...MINUTE, daily: daily(quiet) }
    );

    expect(belowLimit.trades[0]).toMatchObject({
      entryTime: "2026-01-06 09:01",
      entryPrice: 105,
    });
  });

  test("what went ex between sessions reads as no move, and the holding is bought back in", async () => {
    // Went ex of 10 at the second session, which opens at its reference.
    const sessions = [
      [100, 100],
      [90, 91],
    ];

    const result = await backtest(
      kernel,
      TSMC,
      minutes(sessions, (session, index) =>
        session === 1 && index === 0 ? { open: 90, low: 90 } : {}
      ),
      { ...above(0), stopLoss: 0.05 },
      {
        ...MINUTE,
        daily: daily(sessions, (session) => (session === 1 ? 90 : undefined)),
      }
    );

    expect(result.trades[0].exitTime).toBeNull();
    expect(result.interval).toBe(Interval.OneMinute);
    expect(result.bars).toBe(4);
    expect(result.equity).toEqual([
      { date: "2026-01-05", value: 10_000 },
      { date: "2026-01-06", value: expect.closeTo((10_000 / 90) * 91) },
    ]);
  });

  test("the tax withheld from what went ex is taken once, at its session's first bar", async () => {
    const sessions = [
      [100, 100],
      [90, 91],
    ];

    const result = await backtest(
      kernel,
      TSMC,
      minutes(sessions, (session, index) =>
        session === 1 && index === 0 ? { open: 90, low: 90 } : {}
      ),
      above(0),
      {
        ...MINUTE,
        costs: { ...NO_COSTS, dividendTaxRate: 0.3 },
        daily: daily(sessions, (session) => (session === 1 ? 90 : undefined)),
        dividends: [dividend("2026-01-06", 10)],
      }
    );

    expect(result.equity.at(-1)?.value).toBeCloseTo((97 / 90) * 91 * 100);
    expect(result.all.buyAndHold).toBeCloseTo((97 / 90) * (91 / 100) - 1);
  });
});

describe("telling an edge from chance", () => {
  // A wave rises and falls every fifty bars or so, so a rule that holds its rises has real timing.
  const wave = Array.from(
    { length: 300 },
    (_, index) => 100 + 10 * Math.sin(index / 8)
  );

  const waveDays = bars(wave).map(({ time }) => candleDate(Market.TW, time));

  const aboveAverage: RuleStrategy = {
    entry: { crossesAbove: [{ price: "close" }, { sma: 10 }] },
    exit: { crossesBelow: [{ price: "close" }, { sma: 10 }] },
  };

  test("the Sharpe ratio is of the account's session returns, a year's worth at their pace", async () => {
    const closes = Array.from({ length: 30 }, (_, index) =>
      index % 3 === 2 ? 100 + index : 100 + index * 1.5
    );

    const result = await backtest(
      kernel,
      TSMC,
      bars(closes),
      {
        entry: { above: [{ price: "close" }, { value: 0 }] },
        exit: { below: [{ price: "close" }, { value: 0 }] },
      },
      { capital: 10_000, costs: NO_COSTS }
    );

    const values = [10_000, ...result.equity.map(({ value }) => value)];

    const returns = values
      .slice(1)
      .map((value, index) => value / values[index] - 1);

    const mean =
      returns.reduce((sum, value) => sum + value, 0) / returns.length;

    const deviation = Math.sqrt(
      returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
        (returns.length - 1)
    );

    const days = Temporal.PlainDate.from(result.all.from).until(
      result.all.to
    ).days;

    expect(result.all.sharpe).toBeCloseTo(
      (mean / deviation) * Math.sqrt(returns.length / (days / 365.25))
    );
  });

  test("a rule that times the moves beats the same bars in any other order", async () => {
    const result = await backtest(kernel, TSMC, bars(wave), aboveAverage, {
      costs: NO_COSTS,
      split: { day: waveDays[200] },
    });

    expect(result.all.pValue).toBeLessThan(0.01);
    // Each stretch is tested on its own bars.
    expect(result.inSample?.pValue).toBeLessThan(0.05);
    expect(result.outOfSample?.pValue).toBeLessThan(0.05);
    // The test counts the run itself among the orderings, so it never says zero.
    expect(result.all.pValue).toBeGreaterThanOrEqual(
      1 / (BACKTEST_PERMUTATIONS + 1)
    );
  });

  test("a run that never holds has nothing to test", async () => {
    const result = await backtest(
      kernel,
      TSMC,
      bars(wave),
      {
        entry: { above: [{ price: "close" }, { value: 1_000 }] },
        exit: { below: [{ price: "close" }, { value: 0 }] },
      },
      { costs: NO_COSTS }
    );

    expect(result.all.pValue).toBeNull();
    expect(result.all.sharpe).toBeNull();
  });

  test("a split after a share of the sessions starts on the session that share reaches", async () => {
    const shared = await backtest(kernel, TSMC, bars(wave), aboveAverage, {
      costs: NO_COSTS,
      split: { share: 2 / 3 },
    });

    const dated = await backtest(kernel, TSMC, bars(wave), aboveAverage, {
      costs: NO_COSTS,
      split: { day: waveDays[200] },
    });

    expect(shared.outOfSample?.from).toBe(waveDays[200]);
    expect(shared.inSample).toEqual(dated.inSample);
    expect(shared.outOfSample).toEqual(dated.outOfSample);
  });

  test("a scan runs each strategy as it runs alone, without testing its timing", async () => {
    const strategies = [THRESHOLD, aboveAverage];

    const scan = await scanBacktests(kernel, TSMC, bars(wave), strategies, {
      costs: NO_COSTS,
      columns: 2,
    });

    for (const [index, strategy] of strategies.entries()) {
      const alone = await backtest(kernel, TSMC, bars(wave), strategy, {
        costs: NO_COSTS,
      });

      expect(scan.cells[index].all).toEqual({ ...alone.all, pValue: null });
    }

    // Two cells in one row are each other's neighbours, so the first stands for both.
    expect(scan.plateau).toMatchObject({ cell: 0, edge: true });
    expect(scan.plateau?.sharpe).toBeCloseTo(
      ((scan.cells[0].all.sharpe ?? 0) + (scan.cells[1].all.sharpe ?? 0)) / 2
    );

    const unordered = await scanBacktests(kernel, TSMC, bars(wave), strategies);

    expect(unordered.plateau).toBeNull();
  });

  test("a scan's strategies read a bounded number of series between them", async () => {
    const strategies = Array.from(
      { length: MAX_SCAN_SERIES + 1 },
      (_, index): RuleStrategy => ({
        entry: { above: [{ price: "close" }, { sma: index + 2 }] },
        exit: { below: [{ price: "close" }, { value: 0 }] },
      })
    );

    await expect(
      scanBacktests(kernel, TSMC, bars(wave), strategies)
    ).rejects.toThrow(`read ${MAX_SCAN_SERIES} different series at most`);
  });

  test("with one strategy, walking forward runs it from the first test on", async () => {
    const walked = await walkForward(kernel, TSMC, bars(wave), [THRESHOLD], {
      costs: NO_COSTS,
      train: 60,
      test: 20,
    });

    const alone = await backtest(
      kernel,
      TSMC,
      bars(wave).slice(60),
      THRESHOLD,
      {
        costs: NO_COSTS,
      }
    );

    // Windows start every twenty sessions while sixty are left to train on before the last.
    expect(walked.windows).toHaveLength(12);
    expect(walked.windows.map(({ cell }) => cell)).toEqual(Array(12).fill(0));
    expect(walked.windows[0].test.from).toBe(alone.all.from);
    expect(walked.windows.at(-1)?.test.to).toBe(alone.all.to);
    expect(walked.outOfSample).toMatchObject({
      from: alone.all.from,
      to: alone.all.to,
      trades: alone.all.trades,
      totalReturn: alone.all.totalReturn,
      maxDrawdown: alone.all.maxDrawdown,
    });
    expect(walked.equity).toEqual(alone.equity);
    // Held from the close before the first test, as the out-of-sample stretch's own return is.
    expect(walked.holding.at(-1)?.value).toBeCloseTo(
      1_000_000 * (1 + walked.outOfSample.buyAndHold)
    );
    expect(walked.holding.map(({ date }) => date)).toEqual(
      walked.equity.map(({ date }) => date)
    );
  });

  test("a walk forward of more windows than it runs fails before any runs", async () => {
    await expect(
      walkForward(kernel, TSMC, bars(wave), [THRESHOLD], {
        train: 60,
        test: 1,
      })
    ).rejects.toThrow(`makes 240 windows, more than the ${MAX_WALK_WINDOWS}`);
  });

  test("each test follows its training, and the next window starts a test later", async () => {
    const walked = await walkForward(
      kernel,
      TSMC,
      bars(wave),
      [THRESHOLD, aboveAverage],
      {
        costs: NO_COSTS,
      }
    );

    // Two fifths of the 300 sessions train each window, and a quarter of that tests it.
    expect(
      walked.windows.map(({ train, test }) => [train.from, test.from, test.to])
    ).toEqual(
      Array.from({ length: 6 }, (_, window) => [
        waveDays[window * 30],
        waveDays[window * 30 + 120],
        waveDays[Math.min(window * 30 + 149, 299)],
      ])
    );
  });

  // The wave's sessions run from 2026-01-05 to 2027-02-26.
  const monthOpens = waveDays.filter(
    (day, index) =>
      index > 0 && day.slice(0, 7) !== waveDays[index - 1].slice(0, 7)
  );

  test("each rolling window runs as the strategy would from holding nothing at the close before it", async () => {
    const rolled = await rollingBacktest(kernel, TSMC, bars(wave), THRESHOLD, {
      costs: NO_COSTS,
      months: 3,
    });

    // From February, the first whole month, to November, the last with three whole months to run.
    expect(rolled.windows.map(({ from }) => from)).toEqual(
      monthOpens.slice(0, 10)
    );
    expect(rolled.windows.map(({ to }) => to)).toEqual(
      monthOpens
        .slice(3, 13)
        .map((open) => waveDays[waveDays.indexOf(open) - 1])
    );

    for (const window of rolled.windows) {
      const first = waveDays.indexOf(window.from);
      const last = waveDays.indexOf(window.to);

      // Its out-of-sample stretch starts holding nothing too, measured from the bar before it.
      const alone = await backtest(
        kernel,
        TSMC,
        bars(wave).slice(first - 1, last + 1),
        THRESHOLD,
        { costs: NO_COSTS, split: { day: window.from } }
      );

      expect(window).toEqual({ ...alone.outOfSample, pValue: null });
    }
  });

  test("a rule read at the close before a window buys at its first open, so always holding returns what holding does", async () => {
    const rolled = await rollingBacktest(
      kernel,
      TSMC,
      bars(wave),
      {
        entry: { above: [{ price: "close" }, { value: 0 }] },
        exit: { below: [{ price: "close" }, { value: 0 }] },
      },
      { costs: NO_COSTS, months: 2 }
    );

    // Each bar opens at the close before, so only the cash whole shares leave over sets them apart.
    for (const window of rolled.windows) {
      expect(window.totalReturn).toBeCloseTo(window.buyAndHold, 3);
      expect(window.exposure).toBe(1);
    }
  });

  test("rolling windows sum up as shares and spreads, and stand for as many as fit end to end", async () => {
    const { windows, summary } = await rollingBacktest(
      kernel,
      TSMC,
      bars(wave),
      THRESHOLD,
      { costs: NO_COSTS, months: 3 }
    );

    const returns = windows.map(({ totalReturn }) => totalReturn);

    const excess = windows.map(
      ({ totalReturn, buyAndHold }) => totalReturn - buyAndHold
    );

    expect(summary).toEqual({
      windows: 10,
      // The ten span twelve months from February on, which hold four of three months each.
      apart: 4,
      beatHolding: excess.filter((each) => each > 0).length / 10,
      gained: returns.filter((each) => each > 0).length / 10,
      returns: {
        p10: percentile(returns, 10),
        median: median(returns),
        p90: percentile(returns, 90),
      },
      holding: expect.objectContaining({
        median: median(windows.map(({ buyAndHold }) => buyAndHold)),
      }),
      excess: expect.objectContaining({ median: median(excess) }),
      worstDrawdown: Math.max(...windows.map(({ maxDrawdown }) => maxDrawdown)),
      thin: windows.filter(({ trades }) => trades < ENOUGH_TRADES).length,
    });
  });

  test("rolling windows start a step of months apart", async () => {
    const options = { costs: NO_COSTS, months: 3 };

    const monthly = await rollingBacktest(
      kernel,
      TSMC,
      bars(wave),
      THRESHOLD,
      options
    );

    const stepped = await rollingBacktest(kernel, TSMC, bars(wave), THRESHOLD, {
      ...options,
      step: 2,
    });

    expect(stepped.step).toBe(2);
    expect(stepped.windows).toEqual(
      monthly.windows.filter((_, index) => index % 2 === 0)
    );
  });

  test("rolling windows run whole months, and bars too short for one fail the run", async () => {
    const roll = (months: number, step?: number) =>
      rollingBacktest(kernel, TSMC, bars(wave), THRESHOLD, { months, step });

    await expect(roll(13)).rejects.toThrow(
      "Bars from 2026-01-05 to 2027-02-26 hold no whole 13-month window after their first month"
    );
    await expect(roll(0)).rejects.toThrow("whole months, one at least");
    await expect(roll(1.5)).rejects.toThrow("whole months, one at least");
    await expect(roll(3, 0)).rejects.toThrow("whole months, one at least");
  });
});

describe("a strategy's work is bounded before it runs", () => {
  const CONDITION = `A condition is one of above, below, crossesAbove, crossesBelow, all and any; all and any hold 1 to ${MAX_RULE_BRANCHES} conditions and nest ${MAX_RULE_DEPTH} deep at most`;

  const above = (value: number): RuleCondition => ({
    above: [{ price: "close" }, { value }],
  });

  /** `condition` inside `depth` nested `all`. */
  const nested = (depth: number, condition: RuleCondition): RuleCondition =>
    depth === 0 ? condition : { all: [nested(depth - 1, condition)] };

  const refusal = (strategy: RuleStrategy) => {
    const parsed = ruleStrategySchema.safeParse(strategy);

    return parsed.success
      ? null
      : parsed.error.issues.map(({ message }) => message).join("\n");
  };

  test("an ordinary strategy passes and runs", async () => {
    const strategy = ruleStrategySchema.parse({
      entry: {
        all: [
          { crossesAbove: [{ sma: 5 }, { sma: 20 }] },
          {
            any: [
              { below: [{ rsi: 14 }, { value: 70 }] },
              {
                above: [
                  { price: "close" },
                  { bollinger: 20, band: "upper", width: 2.5 },
                ],
              },
            ],
          },
        ],
      },
      exit: { crossesBelow: [{ sma: 5 }, { sma: 20 }] },
      stopLoss: 0.1,
    });

    const closes = Array.from(
      { length: 120 },
      (_, index) => 100 + 10 * Math.sin(index / 8)
    );

    expect(
      (
        await backtest(kernel, TSMC, bars(closes), strategy, {
          costs: NO_COSTS,
        })
      ).trades.length
    ).toBeGreaterThan(0);
  });

  test("a key a strategy does not know is refused, not left out", () => {
    const misspelt = ruleStrategySchema.safeParse({
      ...THRESHOLD,
      stoploss: 0.1,
    });

    const unknownSeries = ruleStrategySchema.safeParse({
      ...THRESHOLD,
      entry: { above: [{ sma: 20, length: 5 }, { value: 100 }] },
    });

    expect(misspelt.error?.issues.map(({ message }) => message)).toEqual([
      'Unrecognized key: "stoploss"',
    ]);
    expect(unknownSeries.success).toBe(false);
  });

  test("a strategy at every limit passes", () => {
    expect(
      refusal({
        entry: nested(MAX_RULE_DEPTH - 1, {
          any: Array.from({ length: MAX_RULE_BRANCHES }, (_, index) =>
            above(index)
          ),
        }),
        exit: above(MAX_RULE_BRANCHES),
      })
    ).toBeNull();
  });

  test("an all or any holding too many conditions is refused", () => {
    expect(
      refusal({
        entry: {
          all: Array.from({ length: MAX_RULE_BRANCHES + 1 }, () => above(1)),
        },
        exit: above(1),
      })
    ).toBe(CONDITION);
  });

  test("conditions nested too deep are refused", () => {
    expect(
      refusal({ entry: above(1), exit: nested(MAX_RULE_DEPTH + 1, above(1)) })
    ).toBe(CONDITION);
  });

  test("a tree far past the limits is refused without being read whole", () => {
    // Shared branches keep it small here; as an agent's script sends it, it is a document of millions.
    const tree = (depth: number): RuleCondition =>
      depth === 0
        ? above(1)
        : { all: Array(MAX_RULE_BRANCHES).fill(tree(depth - 1)) };

    const started = performance.now();

    expect(refusal({ entry: tree(8), exit: tree(8) })).toContain(CONDITION);
    expect(performance.now() - started).toBeLessThan(1000);
  });

  test("too many comparisons are refused, however few series they read", () => {
    const wide = (count: number): RuleCondition => ({
      any: Array.from({ length: count }, () => above(1)),
    });

    // Eight groups of eight in the entry and one in the exit: 65 comparisons of two series.
    expect(
      refusal({
        entry: {
          all: Array.from({ length: 8 }, () => wide(MAX_RULE_BRANCHES)),
        },
        exit: above(1),
      })
    ).toBe(
      `A strategy makes ${MAX_RULE_COMPARISONS} comparisons at most between its entry and exit, and this makes ${MAX_RULE_COMPARISONS + 1}`
    );
  });

  test("too many different series are refused, Bollinger widths among them", () => {
    const widths = Array.from(
      { length: MAX_RULE_SERIES },
      (_, index): RuleCondition => ({
        above: [
          { price: "close" },
          { bollinger: 20, band: "upper", width: (5 + index) / 10 },
        ],
      })
    );

    expect(
      refusal({
        entry: {
          any: [{ any: widths.slice(0, 8) }, { any: widths.slice(8, 16) }],
        },
        exit: {
          any: [{ any: widths.slice(16, 24) }, { any: widths.slice(24) }],
        },
      })
    ).toBe(
      `A strategy reads ${MAX_RULE_SERIES} different series at most between its entry and exit, and this reads ${MAX_RULE_SERIES + 1}`
    );
  });

  test("a Bollinger width off its tenths or out of range is refused", () => {
    const width = (value: number) =>
      refusal({
        entry: {
          above: [
            { price: "close" },
            { bollinger: 20, band: "upper", width: value },
          ],
        },
        exit: above(1),
      });

    expect(width(2.1)).toBeNull();
    expect(width(2.000_001)).not.toBeNull();
    expect(width(0.1)).not.toBeNull();
    expect(width(50)).not.toBeNull();
  });
});

describe("a backtest's bars", () => {
  const daily = bars([100, 101, 102, 103, 104, 105, 106, 107]);

  const paid = [dividend("2026-01-08", 1)];

  const source = {
    candles: async () => daily,
    // As a source does, it reads at least its own lookback, before `since` too.
    candlesSince: async () => daily,
    dividends: vi.fn(async () => paid),
  };

  test("read the listing's distributions only where the costs withhold tax from them", async () => {
    const { dividends: none } = await backtestBars(
      source,
      TSMC,
      Interval.OneDay
    );

    expect(none).toBeUndefined();
    expect(source.dividends).not.toHaveBeenCalled();

    const { dividends: taiwan } = await backtestBars(
      source,
      TSMC,
      Interval.OneDay,
      undefined,
      { dividendTaxRate: 0.3 }
    );

    const { dividends: us } = await backtestBars(
      source,
      { market: Market.US, symbol: "AAPL" },
      Interval.OneDay
    );

    expect(taiwan).toBe(paid);
    expect(us).toBe(paid);
  });

  test("start at since, whatever the source read before it", async () => {
    const { bars: read, daily: references } = await backtestBars(
      source,
      TSMC,
      Interval.OneDay,
      "2026-01-08"
    );

    expect(read.map((bar) => candleDate(Market.TW, bar.time))).toEqual([
      "2026-01-08",
      "2026-01-09",
      "2026-01-12",
      "2026-01-13",
      "2026-01-14",
    ]);
    expect(references).toBeUndefined();
  });

  test("are the app's own history without since", async () => {
    const { bars: read } = await backtestBars(source, TSMC, Interval.OneDay);

    expect(read).toHaveLength(8);
  });

  test("fail by the listing's name when too few are left", async () => {
    await expect(
      backtestBars(source, TSMC, Interval.OneDay, "2026-01-14")
    ).rejects.toThrow("2330 has too few 1d bars to backtest");
  });
});

describe("a strategy's own lines", () => {
  // The engine's own average, so only the terms the lines are on differ from its indicators'.
  const average = sma;

  const crossing: RuleStrategy = {
    entry: { crossesAbove: [{ line: "fast" }, { line: "slow" }] },
    exit: { crossesBelow: [{ line: "fast" }, { line: "slow" }] },
  };

  test("trade as the engine's indicators do, worked out on the first bar's terms across splits and what went ex", async () => {
    for (let seed = 1; seed <= 4; seed++) {
      const whole = walk(seed, 300);
      const closes = strategyBars(TSMC, whole).map((bar) => bar.close);

      const own = await backtest(kernel, TSMC, whole, crossing, {
        lines: { fast: average(closes, 5), slow: average(closes, 20) },
      });

      const engine = await backtest(kernel, TSMC, whole, {
        entry: { crossesAbove: [{ sma: 5 }, { sma: 20 }] },
        exit: { crossesBelow: [{ sma: 5 }, { sma: 20 }] },
      });

      expect(engine.trades.length).toBeGreaterThan(0);
      expect(own.trades).toEqual(engine.trades);
    }
  });

  test("are compared only with each other or a value, since a price and an indicator are on other terms", () => {
    const rules = (other: RuleSeries) =>
      ruleStrategySchema.safeParse({
        entry: { above: [{ line: "signal" }, other] },
        exit: { below: [{ line: "signal" }, { value: 0 }] },
      }).success;

    expect(rules({ value: 0.5 })).toBe(true);
    expect(rules({ line: "level" })).toBe(true);
    expect(rules({ price: "close" })).toBe(false);
    expect(rules({ sma: 20 })).toBe(false);
  });

  test("fail a run that reads a line no code gave, or one of other than a value a bar", async () => {
    const six = bars([95, 98, 102, 110, 99, 97]);
    const signal = { entry: [0, 1, 1, 0, 0, 0], exit: [1, 0, 0, 1, 1, 1] };

    const run = (lines?: Record<string, number[]>) =>
      backtest(
        kernel,
        TSMC,
        six,
        {
          entry: { above: [{ line: "entry" }, { value: 0.5 }] },
          exit: { above: [{ line: "exit" }, { value: 0.5 }] },
        },
        { lines }
      );

    await expect(run()).rejects.toThrow(
      "A rule reads the line entry, which only a strategy's own code gives"
    );
    await expect(run({ entry: signal.entry })).rejects.toThrow(
      "The strategy's code gave no line named exit"
    );
    await expect(run({ ...signal, exit: [1, 0, 0] })).rejects.toThrow(
      "The strategy's line exit holds 3 values for 6 bars"
    );
    await expect(run({ ...signal, constructor: [] })).resolves.toMatchObject({
      trades: [{ entryTime: "2026-01-07", exitTime: "2026-01-09" }],
    });
  });

  test("of each strategy in a scan are its own, and count apart from the engine's series", async () => {
    const whole = walk(3, 300);
    const closes = strategyBars(TSMC, whole).map((bar) => bar.close);

    const sets = Array.from({ length: MAX_SCAN_SERIES + 6 }, (_, index) => ({
      fast: average(closes, 2 + (index % 9)),
      slow: average(closes, 12 + Math.floor(index / 9)),
    }));

    const scan = await scanBacktests(
      kernel,
      TSMC,
      whole,
      sets.map(() => crossing),
      { lines: sets }
    );

    for (const index of [0, 37, sets.length - 1]) {
      const alone = await backtest(kernel, TSMC, whole, crossing, {
        lines: sets[index],
      });

      expect(scan.cells[index].all).toEqual({ ...alone.all, pValue: null });
    }
  });

  test(`hold ${MAX_LINE_VALUES} values at most between them`, async () => {
    const long = bars(Array.from({ length: 2000 }, (_, index) => 100 + index));
    const values = long.map(() => 0);
    const count = Math.floor(MAX_LINE_VALUES / (2 * long.length)) + 1;

    await expect(
      scanBacktests(
        kernel,
        TSMC,
        long,
        Array.from({ length: count }, () => crossing),
        {
          lines: Array.from({ length: count }, () => ({
            fast: [...values],
            slow: [...values],
          })),
        }
      )
    ).rejects.toThrow(`hold ${MAX_LINE_VALUES} values at most`);
  });
});

describe("a strategy's signal", () => {
  const crossing: RuleStrategy = {
    entry: { crossesAbove: [{ sma: 5 }, { sma: 20 }] },
    exit: { crossesBelow: [{ sma: 5 }, { sma: 20 }] },
  };

  test("says the rules held at the close before every fill a backtest of the same bars made", async () => {
    for (let seed = 1; seed <= 4; seed++) {
      const whole = walk(seed, 300);
      const dates = whole.map((bar) => candleDate(Market.TW, bar.time));
      const result = await backtest(kernel, TSMC, whole, crossing);

      expect(result.trades.length).toBeGreaterThan(0);

      for (const trade of result.trades) {
        const bought = dates.indexOf(trade.entryTime);
        const before = ruleSignal(TSMC, whole.slice(0, bought), crossing);

        expect(before).toMatchObject({ time: dates[bought - 1], entry: true });

        if (trade.exitTime !== null) {
          const sold = dates.indexOf(trade.exitTime);

          expect(ruleSignal(TSMC, whole.slice(0, sold), crossing).exit).toBe(
            true
          );
        }
      }
    }
  });

  test("reads a strategy's own lines as its backtest does", () => {
    const six = bars([95, 98, 102, 110, 99, 97]);

    const level = {
      close: [95, 98, 102, 110, 99, 97],
      level: six.map(() => 100),
    };

    const own: RuleStrategy = {
      entry: { crossesAbove: [{ line: "close" }, { line: "level" }] },
      exit: { crossesBelow: [{ line: "close" }, { line: "level" }] },
    };

    const at = (bars: number) =>
      ruleSignal(TSMC, six.slice(0, bars), own, {
        lines: {
          close: level.close.slice(0, bars),
          level: level.level.slice(0, bars),
        },
      });

    expect(at(2)).toEqual({ time: "2026-01-06", entry: false, exit: false });
    expect(at(3)).toEqual({ time: "2026-01-07", entry: true, exit: false });
    expect(at(5)).toEqual({ time: "2026-01-09", entry: false, exit: true });
  });
});
