import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";

import {
  BacktestMode,
  backtestSetupSchema,
  rollingSetupSchema,
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
import { openUserData } from "@solyx/db/user";
import type { UserData } from "@solyx/db/user";
import { kernel } from "@solyx/kernel/kernel";

import { createBacktests } from "../src/modules/backtests/backtests.ts";

const TSMC = { market: Market.TW, symbol: "2330" };

// 10:00 in Taipei on 2026-10-26, a Monday.
const NOW = new Date("2026-10-26T02:00:00Z");

const DAY_SECONDS = 86_400;

const START = Date.UTC(2024, 0, 1) / 1000;

/** A bar every `seconds` from `start` on, waving so moving averages cross. */
function bars(count: number, seconds = DAY_SECONDS, start = START): Candle[] {
  return Array.from({ length: count }, (_, index) => {
    const close = 100 + 15 * Math.sin(index / 12);

    return {
      time: start + index * seconds,
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

  const user = openUserData(
    join(directory, "user.sqlite"),
    join(MIGRATIONS, "user")
  );

  opened.push(user);

  const onHistoryChange = vi.fn();
  // A second on with each read, so the runs kept fall in the order they ran.
  let at = NOW.getTime();

  return {
    marketData,
    onHistoryChange,
    run: createBacktests({
      marketData,
      kernel,
      history: user.backtestRuns,
      onHistoryChange,
      now: () => new Date((at += 1000)),
    }),
  };
}

const MIGRATIONS = fileURLToPath(
  new URL("../../db/migrations", import.meta.url)
);

let directory: string;

let opened: UserData[];

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "solyx-backtests-"));
  opened = [];
});

afterEach(async () => {
  for (const user of opened) user.close();
  await rm(directory, { recursive: true, force: true });
});

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
  // Minute bars from 09:00 in Taipei a week before, and daily bars over the year before.
  const { marketData, run } = backtests((interval) =>
    interval === Interval.OneDay
      ? bars(400, DAY_SECONDS, Date.UTC(2025, 9, 1) / 1000)
      : bars(270, 60, Date.UTC(2026, 9, 19, 1) / 1000)
  );

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

test("rolling windows run a setup from each month's first session and are kept with what they came to", async () => {
  const { run } = backtests();

  const setup = rollingSetupSchema.parse({
    ...reach,
    strategy: initialSetup(StrategyTemplate.MovingAverageCross),
    months: 6,
    step: 1,
  });

  const rolled = await run.rolling(setup);

  // The bars run from 2024-01-01 to 2025-08-22: windows start from February 2024, the first whole
  // month, to February 2025, the last with six whole months after it.
  expect(rolled.windows).toHaveLength(13);
  expect(rolled.windows[0]).toMatchObject({
    from: "2024-02-01",
    to: "2024-07-31",
  });
  expect(rolled.windows.at(-1)?.from).toBe("2025-02-01");

  const [kept] = run.history();

  expect(kept.request).toEqual({ mode: BacktestMode.Rolling, setup });
  expect(kept.headline).toEqual(rolled.summary);
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

  // Counted rather than made, so an axis of a trillion steps is refused at once.
  expect(
    scanSetupSchema
      .safeParse({
        ...reach,
        strategy: initialSetup(StrategyTemplate.MovingAverageCross),
        rows: { param: "slow", from: 0, to: 1e12, step: 1e-6 },
        columns: { param: "fast", from: -1.7e308, to: 1.7e308, step: 1 },
        split: 0.5,
      })
      .error?.issues.map((issue) => `${issue.path.join(".")} ${issue.message}`)
  ).toEqual([
    "rows An axis takes 1 to 20 values",
    "columns An axis takes 1 to 20 values",
  ]);
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

test("each run a window asks for is kept once, with the stretch it is judged by, and compared again on today's bars", async () => {
  const { run, onHistoryChange } = backtests();
  const strategy = initialSetup(StrategyTemplate.MovingAverageCross);
  const setup = backtestSetupSchema.parse({ ...reach, strategy, split: 0.5 });
  const { rows, columns } = STRATEGY_TEMPLATES[strategy.template].grid;

  const result = await run.run(setup);

  await run.run(setup);
  await run.scan(
    scanSetupSchema.parse({ ...reach, strategy, rows, columns, split: 0.5 })
  );

  const [scanned, ran] = run.history();

  expect(run.history()).toHaveLength(2);
  expect(onHistoryChange).toHaveBeenCalledTimes(3);
  expect(ran.request).toEqual({ mode: BacktestMode.Run, setup });
  expect(ran.headline).toEqual(result.outOfSample);
  expect(scanned.request.mode).toBe(BacktestMode.Scan);

  const [compared] = await run.compare([ran.id]);

  expect(compared).toEqual({ id: ran.id, result });
  expect(run.history()).toHaveLength(2);
  await expect(run.compare([scanned.id])).rejects.toThrow(
    "No single backtest is kept"
  );

  run.remove(ran.id);

  expect(run.history().map(({ id }) => id)).toEqual([scanned.id]);
});
