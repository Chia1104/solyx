import { describe, expect, test } from "vite-plus/test";

import {
  backtest,
  defaultCosts,
  MAX_RULE_BRANCHES,
  MAX_RULE_COMPARISONS,
  MAX_RULE_DEPTH,
  MAX_RULE_SERIES,
  ruleStrategySchema,
} from "../src/backtest.ts";
import type { RuleCondition, RuleStrategy } from "../src/backtest.ts";
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

test("a buy takes the most shares the cash covers with the minimum commission, rather than none", () => {
  // 1,010 buys ten shares at 100 before the commission, but the minimum of 20 leaves room for nine.
  const result = backtest(
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

test("buying and holding a stretch starts from the close its return is measured from", () => {
  // Held from the second bar on; the split falls on the bar that doubled.
  const result = backtest(
    TSMC,
    bars([100, 100, 100, 200, 200]),
    {
      entry: { above: [{ price: "close" }, { value: 0 }] },
      exit: { below: [{ price: "close" }, { value: 0 }] },
    },
    { capital: 100_000, costs: NO_COSTS, split: "2026-01-08" }
  );

  expect(result.outOfSample?.totalReturn).toBeCloseTo(1);
  expect(result.outOfSample?.buyAndHold).toBeCloseTo(1);
});

test("buying and holding's drawdown is its deepest fall from a high, from the close its stretch is measured from", () => {
  const result = backtest(
    TSMC,
    bars([100, 120, 130, 110, 80]),
    {
      entry: { above: [{ price: "close" }, { value: 1000 }] },
      exit: { below: [{ price: "close" }, { value: 0 }] },
    },
    { capital: 100_000, costs: NO_COSTS, split: "2026-01-08" }
  );

  // The stretch from the fourth bar is measured from the close of 130, its high.
  expect(result.all.buyAndHoldDrawdown).toBeCloseTo(1 - 80 / 130);
  expect(result.inSample?.buyAndHoldDrawdown).toBe(0);
  expect(result.outOfSample?.buyAndHoldDrawdown).toBeCloseTo(1 - 80 / 130);
  // Holding nothing loses nothing.
  expect(result.all.maxDrawdown).toBe(0);
});

describe("splits and what went ex", () => {
  // Bought at the second bar's open and never sold.
  const holding: RuleStrategy = {
    entry: { above: [{ price: "close" }, { value: 0 }] },
    exit: { below: [{ price: "close" }, { value: 0 }] },
    stopLoss: 0.1,
  };

  test("a split while held reads as no move: the stop holds, and the holding carries over", () => {
    // Split one to four on the fourth bar.
    const result = backtest(
      TSMC,
      bars([100, 100, 100, 25, 26], (index) =>
        index === 3 ? { open: 25, high: 25.5, low: 25, reference: 25 } : {}
      ),
      holding,
      { capital: 10_000, costs: NO_COSTS }
    );

    expect(result.trades).toEqual([
      {
        entryDate: "2026-01-06",
        entryPrice: 100,
        exitDate: null,
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

  test("what went ex while held is bought back in at the reference", () => {
    // Went ex of 4 on the fourth bar.
    const result = backtest(
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

  test("a rule against a price reads it as traded, whatever later bars went ex of", () => {
    const strategy: RuleStrategy = {
      entry: { crossesAbove: [{ price: "close" }, { value: 100 }] },
      exit: { below: [{ price: "close" }, { value: 0 }] },
    };

    const closes = [98, 101, 103, 104, 52];

    const asTraded = backtest(TSMC, bars(closes), strategy, {
      capital: 10_000,
      costs: NO_COSTS,
    });

    // Split one to two on the last bar, after the cross.
    const split = backtest(
      TSMC,
      bars(closes, (index) =>
        index === 4 ? { open: 52, high: 52, low: 51, reference: 52 } : {}
      ),
      strategy,
      { capital: 10_000, costs: NO_COSTS }
    );

    expect(split.trades[0].entryDate).toBe(asTraded.trades[0].entryDate);
  });

  test("a bar locked at its limit is read against its reference", () => {
    // Went ex of 12 on the fourth bar and locked up at 99, its limit from 90 though under the close before.
    const result = backtest(
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
      entryDate: "2026-01-09",
      entryPrice: 99,
    });
  });
});

describe("no rule sees a later price", () => {
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
        low: lockedUp
          ? next
          : tick(Math.min(open, next) * (1 - random() * 0.01)),
        close: next,
        reference,
      };
    });
  }

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

  const filled = (result: ReturnType<typeof backtest>, through: string) =>
    result.trades
      .filter(({ entryDate }) => entryDate <= through)
      .map((trade) => ({
        entryDate: trade.entryDate,
        entryPrice: trade.entryPrice,
        shares: trade.shares,
        exit:
          trade.exitDate !== null && trade.exitDate <= through
            ? [trade.exitDate, trade.exitPrice]
            : null,
      }));

  test("a run cut short agrees with the whole run up to the cut", () => {
    for (let seed = 1; seed <= 8; seed++) {
      const whole = walk(seed, 300);

      for (const strategy of strategies) {
        const result = backtest(TSMC, whole, strategy);

        for (const cut of [40, 120, 210, 290]) {
          const short = backtest(TSMC, whole.slice(0, cut + 1), strategy);
          const day = result.equity[cut].date;

          expect(short.equity).toEqual(result.equity.slice(0, cut + 1));
          expect(filled(short, day)).toEqual(filled(result, day));
        }
      }
    }
  });

  test("rewriting the bars after one, the next one's open kept, changes no fill up to that open", () => {
    for (let seed = 1; seed <= 8; seed++) {
      const whole = walk(seed, 300);
      const other = walk(seed + 100, 300);

      for (const strategy of strategies) {
        const result = backtest(TSMC, whole, strategy);

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

          expect(filled(backtest(TSMC, rewritten, strategy), day)).toEqual(
            filled(result, day)
          );
        }
      }
    }
  });
});

describe("a strategy's work is bounded before it runs", () => {
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

  test("an ordinary strategy passes and runs", () => {
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
      backtest(TSMC, bars(closes), strategy, { costs: NO_COSTS }).trades.length
    ).toBeGreaterThan(0);
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
    ).toBe(
      `A condition is one of above, below, crossesAbove, crossesBelow, all and any, and all and any hold 1 to ${MAX_RULE_BRANCHES} conditions`
    );
  });

  test("conditions nested too deep are refused", () => {
    expect(
      refusal({ entry: above(1), exit: nested(MAX_RULE_DEPTH + 1, above(1)) })
    ).toBe(
      `all and any nest ${MAX_RULE_DEPTH} deep at most, and this nests ${MAX_RULE_DEPTH + 1}`
    );
  });

  test("too many comparisons are refused, however few series they read", () => {
    const wide = (count: number): RuleCondition => ({
      any: Array.from({ length: count }, () => above(1)),
    });

    // Four groups of sixteen in the entry and one in the exit: 65 comparisons of two series.
    expect(
      refusal({
        entry: {
          all: Array.from({ length: 4 }, () => wide(MAX_RULE_BRANCHES)),
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
        entry: { any: widths.slice(0, 16) },
        exit: { any: widths.slice(16) },
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
