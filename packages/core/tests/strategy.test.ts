import { describe, expect, test } from "vite-plus/test";

import { strategyBars } from "../src/backtest.ts";
import { Interval } from "../src/candles.ts";
import type { Candle } from "../src/candles.ts";
import { Market } from "../src/market.ts";
import {
  MAX_STRATEGY_PARAMS,
  lookAhead,
  lookAheadCuts,
  readStrategyOutput,
  strategyInput,
  strategyJobs,
  strategyManifestSchema,
  strategyParams,
} from "../src/strategy.ts";

const TSMC = { market: Market.TW, symbol: "2330" };

const MANIFEST = {
  name: "atr-breakout",
  description: "Buys a close above the highest high plus k ATRs",
  run: "python3 strategy.py",
  params: {
    period: { min: 10, max: 60, step: 5, initial: 20 },
    k: { min: 0.5, max: 3, step: 0.5, initial: 1.5 },
  },
  rules: {
    entry: { crossesAbove: [{ line: "close" }, { line: "upper" }] },
    exit: { below: [{ line: "close" }, { line: "trend" }] },
    stopLoss: 0.08,
  },
};

describe("a strategy's manifest", () => {
  test("reads the command, the numbers and the rules", () => {
    const manifest = strategyManifestSchema.parse(MANIFEST);

    expect(manifest.params.k.initial).toBe(1.5);
    expect(manifest.rules.stopLoss).toBe(0.08);
    expect(
      strategyManifestSchema.parse({ ...MANIFEST, params: undefined }).params
    ).toEqual({});
  });

  test("refuses a name its folder could not have, a start off its steps, too many numbers and a key it does not know", () => {
    const variants = [
      { ...MANIFEST, name: "ATR Breakout" },
      {
        ...MANIFEST,
        params: { k: { min: 0.5, max: 3, step: 0.5, initial: 1.2 } },
      },
      {
        ...MANIFEST,
        params: Object.fromEntries(
          Array.from({ length: MAX_STRATEGY_PARAMS + 1 }, (_, index) => [
            `p${index}`,
            { min: 0, max: 1, step: 1, initial: 0 },
          ])
        ),
      },
      { ...MANIFEST, stop: 0.05 },
    ];

    for (const variant of variants) {
      expect(strategyManifestSchema.safeParse(variant).success).toBe(false);
    }
  });

  test("refuses a rule that reads its line against a price, which is on other terms", () => {
    expect(
      strategyManifestSchema.safeParse({
        ...MANIFEST,
        rules: {
          entry: { above: [{ price: "close" }, { line: "upper" }] },
          exit: { below: [{ line: "close" }, { line: "trend" }] },
        },
      }).success
    ).toBe(false);
  });
});

describe("a strategy's numbers", () => {
  const manifest = strategyManifestSchema.parse(MANIFEST);

  test("start from their initial values where none is given", () => {
    expect(strategyParams(manifest, { k: 2 })).toEqual({ period: 20, k: 2 });
  });

  test("refuse a number the strategy does not take, or one off its steps", () => {
    expect(() => strategyParams(manifest, { width: 2 })).toThrow(
      "atr-breakout takes no number named width"
    );
    expect(() => strategyParams(manifest, { k: 1.2 })).toThrow(
      "atr-breakout's k is from 0.5 to 3 in steps of 0.5"
    );
    expect(() => strategyParams(manifest, { constructor: 1 })).toThrow(
      "takes no number named constructor"
    );
  });
});

describe("what a strategy's code is handed", () => {
  // A split halves the price at the third bar.
  const split: Candle[] = [100, 102, 52, 53].map((close, index) => ({
    time: Date.UTC(2026, 0, 5 + index, 1) / 1000,
    open: close,
    high: close,
    low: close,
    close,
    volume: 1000,
  }));

  split[2].reference = 51;

  test("is the bars adjusted on the first bar's terms, each a column, timed on the exchange's clock", () => {
    const { runs } = strategyJobs([{ period: 20 }], 4);

    const input = strategyInput(
      TSMC,
      Interval.OneDay,
      strategyBars(TSMC, split),
      runs
    );

    expect(input.bars.time).toEqual([
      "2026-01-05",
      "2026-01-06",
      "2026-01-07",
      "2026-01-08",
    ]);
    expect(input.bars.close).toEqual([100, 102, 104, 106]);
    expect(input.bars.volume).toEqual([1000, 1000, 500, 500]);
    expect(input.jobs).toEqual([
      { id: "run0", params: { period: 20 }, bars: 4 },
    ]);
  });

  test("keeps an earlier bar as it was once later bars split", () => {
    const short = strategyBars(TSMC, split.slice(0, 2));

    expect(strategyBars(TSMC, split).slice(0, 2)).toEqual(short);
  });

  test("runs the first numbers again over fewer bars for the look-ahead check", () => {
    const { runs, cuts } = strategyJobs([{ k: 1 }, { k: 2 }], 100);

    expect(runs.map((job) => job.id)).toEqual(["run0", "run1"]);
    expect(cuts).toEqual([
      { id: "cut0", params: { k: 1 }, bars: 20 },
      { id: "cut1", params: { k: 1 }, bars: 40 },
      { id: "cut2", params: { k: 1 }, bars: 60 },
      { id: "cut3", params: { k: 1 }, bars: 80 },
    ]);
    expect(lookAheadCuts(6)).toEqual([2, 3, 4]);
    expect(lookAheadCuts(2)).toEqual([]);
  });
});

describe("what a strategy's code writes", () => {
  const jobs = [
    { id: "run0", params: {}, bars: 3 },
    { id: "cut0", params: {}, bars: 2 },
  ];

  test("is each job's lines, a missing value written as NaN read as none", () => {
    const lines = readStrategyOutput(
      '{"run0": {"upper": [NaN, 1.5, Infinity], "NaN": [1, 2, 3]}, "cut0": {"upper": [null, -Infinity]}}',
      { jobs }
    );

    expect(lines.get("run0")).toEqual({
      upper: [null, 1.5, null],
      NaN: [1, 2, 3],
    });
    expect(lines.get("cut0")).toEqual({ upper: [null, null] });
  });

  test("fails a run that leaves a job out, gives a line other than a value a bar, or is not JSON", () => {
    expect(() =>
      readStrategyOutput('{"run0": {"upper": [1, 2, 3]}}', { jobs })
    ).toThrow("The strategy's code wrote no lines for cut0");
    expect(() =>
      readStrategyOutput(
        '{"run0": {"upper": [1, 2]}, "cut0": {"upper": [1, 2]}}',
        { jobs }
      )
    ).toThrow("gave run0 2 values of upper for 3 bars");
    expect(() => readStrategyOutput("lines: [1, 2]", { jobs })).toThrow(
      "does not read as JSON"
    );
    expect(() =>
      readStrategyOutput('{"run0": {"upper": ["1"]}}', { jobs })
    ).toThrow("lines that do not read");
  });
});

describe("the look-ahead check", () => {
  const closes = Array.from({ length: 50 }, (_, index) =>
    Math.round(100 + 10 * Math.sin(index / 3))
  );

  /** What a strategy's code would give over the first `bars` of the closes. */
  const runs = (code: (values: number[]) => (number | null)[]) => ({
    full: { line: code(closes) },
    cuts: lookAheadCuts(closes.length).map((bars) => ({
      line: code(closes.slice(0, bars)),
    })),
  });

  const check = (code: (values: number[]) => (number | null)[]) => {
    const { full, cuts } = runs(code);

    return lookAhead(full, cuts);
  };

  test("finds nothing in a line read from its bar and the ones before it", () => {
    expect(
      check((values) =>
        values.map((_, index) =>
          index < 4 ? null : (values[index] + values[index - 4]) / 2
        )
      )
    ).toBeNull();
  });

  test("finds a line that reads the next bar, at the last bar a shorter run had", () => {
    expect(
      check((values) => values.map((_, index) => values[index + 1] ?? null))
    ).toEqual({ line: "line", bar: 9 });
  });

  test("finds a line scaled by the whole run's mean from its first bar", () => {
    expect(
      check((values) => {
        const mean =
          values.reduce((sum, value) => sum + value, 0) / values.length;

        return values.map((value) => value - mean);
      })
    ).toEqual({ line: "line", bar: 0 });
  });

  test("finds a line a shorter run left out, from the first bar", () => {
    expect(
      lookAhead({ upper: [1, 2], lower: [0, 1] }, [{ upper: [1] }])
    ).toEqual({ line: "lower", bar: 0 });
  });
});
