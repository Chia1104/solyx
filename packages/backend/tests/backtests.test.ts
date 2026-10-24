import { expect, test, vi } from "vite-plus/test";

import {
  backtestSetupSchema,
  scanSetupSchema,
  walkForwardSetupSchema,
} from "@solyx/api/backtests";
import { Interval } from "@solyx/core/candles";
import type { Candle } from "@solyx/core/candles";
import { Market } from "@solyx/core/market";
import type { SymbolRef } from "@solyx/core/market";
import {
  STRATEGY_TEMPLATES,
  StrategyTemplate,
  initialSetup,
} from "@solyx/core/strategy-templates";
import { kernel } from "@solyx/kernel/kernel";

import { createBacktests } from "../src/modules/backtests/backtests.ts";

const TSMC = { market: Market.TW, symbol: "2330" };

// 10:00 in Taipei on 2026-10-26, a Monday.
const NOW = new Date("2026-10-26T02:00:00Z");

const DAY_SECONDS = 86_400;

/** A bar a day from 2024-01-01 on, waving so moving averages cross. */
function bars(count: number, seconds = DAY_SECONDS): Candle[] {
  return Array.from({ length: count }, (_, index) => {
    const close = 100 + 15 * Math.sin(index / 12);

    return {
      time: Date.UTC(2024, 0, 1) / 1000 + index * seconds,
      open: close,
      high: close + 1,
      low: close - 1,
      close,
      volume: 1000,
    };
  });
}

function backtests(
  read = (interval: Interval) =>
    interval === Interval.OneDay ? bars(600) : bars(400, 60)
) {
  const marketData = {
    candles: vi.fn(async () => bars(600)),
    candlesSince: vi.fn(async (_symbol: SymbolRef, interval: Interval) =>
      read(interval)
    ),
  };

  return {
    marketData,
    run: createBacktests({ marketData, kernel, now: () => NOW }),
  };
}

const reach = { symbol: TSMC, interval: Interval.OneDay, years: 5 };

test("a run reads the listing's bars from its years back on the exchange's calendar and splits at its share", async () => {
  const { marketData, run } = backtests();

  const result = await run.run(
    backtestSetupSchema.parse({
      ...reach,
      strategy: initialSetup(StrategyTemplate.MovingAverageCross),
      split: 2 / 3,
    })
  );

  expect(marketData.candlesSince).toHaveBeenCalledWith(
    TSMC,
    Interval.OneDay,
    "2021-10-26"
  );
  expect(result.bars).toBe(600);
  expect(result.trades.length).toBeGreaterThan(0);
  const { inSample, outOfSample } = result;

  expect(inSample && outOfSample && inSample.to < outOfSample.from).toBe(true);
});

test("a run on bars shorter than a day reads the daily bars of the same years for their references", async () => {
  const { marketData, run } = backtests();

  const result = await run.run(
    backtestSetupSchema.parse({
      ...reach,
      interval: Interval.OneMinute,
      years: 1,
      strategy: initialSetup(StrategyTemplate.KdCross),
      split: 0.5,
    })
  );

  expect(
    marketData.candlesSince.mock.calls.map(([, interval]) => interval)
  ).toEqual([Interval.OneMinute, Interval.OneDay]);
  expect(result.interval).toBe(Interval.OneMinute);
});

test("a scan runs its grid's setups row by row, and a walk forward picks among them", async () => {
  const { run } = backtests();
  const strategy = initialSetup(StrategyTemplate.MovingAverageCross);
  const { rows, columns } = STRATEGY_TEMPLATES[strategy.template].grid;

  const scan = await run.scan(
    scanSetupSchema.parse({ ...reach, strategy, rows, columns, split: 2 / 3 })
  );

  expect(scan.cells).toHaveLength(9 * 6);
  expect(scan.plateau).not.toBeNull();

  const walked = await run.walkForward(
    walkForwardSetupSchema.parse({ ...reach, strategy, rows, columns })
  );

  expect(walked.windows.length).toBeGreaterThan(0);
  expect(walked.windows.every((window) => (window.cell ?? 0) < 54)).toBe(true);
});

test("a setup refuses years past what its interval's history reaches, and a grid that would not run", () => {
  const strategy = initialSetup(StrategyTemplate.BollingerBreakout);

  expect(
    backtestSetupSchema
      .safeParse({
        ...reach,
        interval: Interval.FiveMinutes,
        years: 5,
        strategy,
        split: 0.5,
      })
      .error?.issues.map((issue) => issue.path.join("."))
  ).toEqual(["years"]);

  expect(
    scanSetupSchema.safeParse({
      ...reach,
      strategy,
      rows: { param: "period", from: 5, to: 60, step: 5 },
      columns: { param: "width", from: 1, to: 3, step: 0.2 },
      split: 0.5,
    }).error?.issues[0]?.message
  ).toContain("tooManySeries");
});

test("too few bars fail the run with the listing's name", async () => {
  const { run } = backtests(() => bars(1));

  await expect(
    run.run(
      backtestSetupSchema.parse({
        ...reach,
        strategy: initialSetup(StrategyTemplate.MacdCross),
        split: 0.5,
      })
    )
  ).rejects.toThrow("too few 1d bars");
});
