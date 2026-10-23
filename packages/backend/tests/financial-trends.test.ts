import { expect, test, vi } from "vite-plus/test";

import type {
  Fundamentals,
  MonthlyRevenue,
  QuarterStatement,
} from "@solyx/core/fundamentals";
import { Market } from "@solyx/core/market";

import { financialTrends } from "../src/modules/fundamentals/financial-trends.ts";

const TSMC = { market: Market.TW, symbol: "2330" };

const quarter = (periodEnd: string, revenue: number): QuarterStatement => ({
  periodEnd,
  knownFrom: periodEnd,
  revenue,
  grossProfit: null,
  operatingIncome: null,
  netIncome: null,
  eps: revenue / 100,
});

// Twelve quarters, each a tenth larger than the one before.
const STATEMENTS = Array.from({ length: 12 }, (_, index) => {
  const end = Temporal.PlainYearMonth.from("2023-09")
    .add({ months: index * 3 })
    .toPlainDate({ day: 1 })
    .with({ day: 31 });

  return quarter(end.toString(), 1000 * 1.1 ** index);
});

// Twenty-six months of the same revenue but the newest, which doubles.
const MONTHLY: MonthlyRevenue[] = Array.from({ length: 26 }, (_, index) => ({
  month: Temporal.PlainYearMonth.from("2024-08")
    .add({ months: index })
    .toString(),
  revenue: index === 25 ? 200 : 100,
}));

function setup(source: string | undefined) {
  const fundamentals = {
    source: vi.fn<Fundamentals["source"]>(() => source),
    statements: vi.fn<Fundamentals["statements"]>(async () => STATEMENTS),
    monthlyRevenue: vi.fn<Fundamentals["monthlyRevenue"]>(async () => MONTHLY),
  };

  return { fundamentals, read: () => financialTrends(fundamentals, TSMC) };
}

test("a listing's newest quarters and months come with growth measured over all that is kept", async () => {
  const { read } = setup("fake");
  const trends = await read();

  expect(trends?.quarters).toHaveLength(8);
  expect(trends?.quarters.at(0)?.statement.periodEnd).toBe(
    STATEMENTS.at(4)?.periodEnd
  );
  // The oldest quarter shown still has the quarter a year before it, which is not shown.
  expect(trends?.quarters.at(0)?.revenueYoY).toBeCloseTo(1.1 ** 4 - 1);
  expect(trends?.quarters.at(-1)?.epsYoY).toBeCloseTo(1.1 ** 4 - 1);

  expect(trends?.months).toHaveLength(12);
  expect(trends?.months.at(0)).toMatchObject({ month: "2025-10", yoy: 0 });
  expect(trends?.months.at(-1)).toMatchObject({ month: "2026-09", yoy: 1 });
});

test("a market no source covers answers null and reads nothing", async () => {
  const { fundamentals, read } = setup(undefined);

  expect(await read()).toBeNull();
  expect(fundamentals.statements).not.toHaveBeenCalled();
  expect(fundamentals.monthlyRevenue).not.toHaveBeenCalled();
});

test("a listing that files nothing answers with none of either", async () => {
  const { fundamentals, read } = setup("fake");

  fundamentals.statements.mockResolvedValue([]);
  fundamentals.monthlyRevenue.mockResolvedValue([]);

  expect(await read()).toEqual({ quarters: [], months: [] });
});
