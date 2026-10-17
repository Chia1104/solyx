import { expect, test } from "vite-plus/test";

import type { Candle } from "../src/candles.ts";
import {
  balanceSheetMetrics,
  cashFlowMetrics,
  cashGoneExBy,
  premium,
  priceToEarnings,
  revenueTrend,
  statementMetrics,
  trailingCash,
} from "../src/fundamentals.ts";
import type {
  BalanceSheet,
  CashFlow,
  Dividend,
  QuarterStatement,
} from "../src/fundamentals.ts";
import { Market } from "../src/market.ts";
import { twFilingDeadline } from "../src/rules/tw.ts";

function quarter(
  periodEnd: string,
  revenue: number,
  eps: number | null,
  patch: Partial<QuarterStatement> = {}
): QuarterStatement {
  return {
    periodEnd,
    knownFrom: twFilingDeadline(periodEnd),
    revenue,
    grossProfit: revenue * 0.5,
    operatingIncome: revenue * 0.4,
    netIncome: revenue * 0.3,
    eps,
    ...patch,
  };
}

const QUARTERS = [
  quarter("2025-03-31", 800, 10),
  quarter("2025-06-30", 900, 12),
  quarter("2025-09-30", 1000, 14),
  quarter("2025-12-31", 1100, 16),
  quarter("2026-03-31", 1200, 20),
  quarter("2026-06-30", 1350, 24),
];

function bar(date: string, close: number): Candle {
  return {
    time: Date.parse(`${date}T00:00:00+08:00`) / 1000,
    open: close,
    high: close,
    low: close,
    close,
    volume: 1000,
  };
}

test("a filing deadline follows its quarter, the fourth into the next year", () => {
  expect(
    ["2025-03-31", "2025-06-30", "2025-09-30", "2025-12-31"].map(
      twFilingDeadline
    )
  ).toEqual(["2025-05-15", "2025-08-14", "2025-11-14", "2026-03-31"]);
});

test("statementMetrics compares each quarter with the one before and the year before", () => {
  const metrics = statementMetrics(QUARTERS);

  expect(metrics[0]).toMatchObject({
    revenueYoY: null,
    revenueQoQ: null,
    epsYoY: null,
    trailingEps: null,
    grossMargin: 0.5,
    operatingMargin: 0.4,
    netMargin: 0.3,
  });
  expect(metrics[5].revenueYoY).toBeCloseTo(0.5);
  expect(metrics[5].revenueQoQ).toBeCloseTo(0.125);
  expect(metrics[5].epsYoY).toBeCloseTo(1);
  expect(metrics[3].trailingEps).toBe(52);
  expect(metrics[5].trailingEps).toBe(74);
});

test("statementMetrics leaves out what a missing quarter or figure would need", () => {
  const [first, , third, fourth, fifth] = QUARTERS;

  const metrics = statementMetrics([
    first,
    third,
    fourth,
    quarter("2026-03-31", 1200, null, { grossProfit: null }),
  ]);

  // The second quarter of 2025 is missing, so the third has no quarter before it.
  expect(metrics[1].revenueQoQ).toBe(null);
  expect(metrics[2].trailingEps).toBe(null);
  expect(metrics[3]).toMatchObject({
    grossMargin: null,
    epsYoY: null,
    trailingEps: null,
  });
  expect(metrics[3].revenueYoY).toBeCloseTo(fifth.revenue / first.revenue - 1);
});

test("growth from a loss is measured against the loss's size", () => {
  const [metrics] = statementMetrics([
    quarter("2025-03-31", 800, -2),
    quarter("2026-03-31", 800, 1),
  ]).slice(1);

  expect(metrics.epsYoY).toBeCloseTo(1.5);
});

function sheet(patch: Partial<BalanceSheet>): BalanceSheet {
  return {
    periodEnd: "2026-06-30",
    totalAssets: 1500,
    totalLiabilities: 1200,
    equity: 300,
    cash: 120,
    receivables: 570,
    inventories: 530,
    currentAssets: 1380,
    currentLiabilities: 1150,
    shortTermBorrowings: 425,
    longTermBorrowings: 58,
    bondsPayable: 48,
    ...patch,
  };
}

test("balanceSheetMetrics sets current assets and all liabilities against what they are measured by", () => {
  const [whole, bank] = balanceSheetMetrics([
    sheet({}),
    // A bank reports no current lines.
    sheet({ currentAssets: null, currentLiabilities: null }),
  ]);

  expect(whole.currentRatio).toBeCloseTo(1.2);
  expect(whole.liabilitiesToAssets).toBeCloseTo(0.8);
  expect(bank.currentRatio).toBe(null);
  expect(bank.liabilitiesToAssets).toBeCloseTo(0.8);
});

function flow(
  periodEnd: string,
  operating: number,
  capitalExpenditure: number | null
): CashFlow {
  return {
    periodEnd,
    operating,
    capitalExpenditure,
    investing: null,
    financing: null,
  };
}

test("cashFlowMetrics takes capital expenditure from operating cash flow and adds up the four quarters each closes", () => {
  const metrics = cashFlowMetrics([
    flow("2025-06-30", 500, 300),
    flow("2025-09-30", 400, 280),
    flow("2025-12-31", 700, 350),
    flow("2026-03-31", -140, 90),
    flow("2026-06-30", 600, null),
  ]);

  expect(metrics[3]).toMatchObject({
    freeCashFlow: -230,
    trailingOperating: 1460,
    trailingFreeCashFlow: 440,
  });
  // No capital expenditure is reported, so what the quarter leaves cannot be told.
  expect(metrics[4]).toMatchObject({
    freeCashFlow: null,
    trailingOperating: 1560,
    trailingFreeCashFlow: null,
  });
  // The quarters before the first are missing.
  expect(metrics[2].trailingOperating).toBe(null);
});

test("revenueTrend compares each month with the one before and the year before", () => {
  const trend = revenueTrend([
    { month: "2025-08", revenue: 300 },
    { month: "2026-07", revenue: 400 },
    { month: "2026-08", revenue: 450 },
  ]);

  expect(trend[0]).toMatchObject({ yoy: null, mom: null });
  expect(trend[2].yoy).toBeCloseTo(0.5);
  expect(trend[2].mom).toBeCloseTo(0.125);
});

test("priceToEarnings uses only the results that were public on each bar's day", () => {
  expect(
    priceToEarnings(
      Market.TW,
      [
        // Before the fourth quarter of 2025 was due, four quarters are not yet public.
        bar("2026-03-30", 1040),
        bar("2026-03-31", 1040),
        // The first quarter of 2026 is due on 05-15.
        bar("2026-05-14", 1240),
        bar("2026-05-15", 1240),
      ],
      QUARTERS
    )
  ).toEqual([
    { date: "2026-03-31", pe: 20 },
    { date: "2026-05-14", pe: 1240 / 52 },
    { date: "2026-05-15", pe: 20 },
  ]);
});

test("priceToEarnings has no multiple while the trailing EPS is a loss", () => {
  const losses = QUARTERS.map((each) => ({ ...each, eps: -1 }));

  expect(priceToEarnings(Market.TW, [bar("2026-09-01", 100)], losses)).toEqual(
    []
  );
});

function dividend(cash: number, cashExDate: string | null): Dividend {
  return {
    period: "114年第2季",
    announced: "2025-11-26",
    cash,
    stock: 0,
    cashExDate,
    cashPaidOn: null,
    stockExDate: null,
  };
}

test("trailingCash adds the cash that went ex in the year through the day, and none set to come", () => {
  const dividends = [
    dividend(4.5, "2025-09-16"),
    dividend(5, "2025-12-11"),
    dividend(6, "2026-03-17"),
    dividend(6, "2026-06-11"),
    dividend(7, "2026-09-16"),
    // Set to go ex after the day, and not set yet.
    dividend(7, "2026-12-10"),
    dividend(7, null),
  ];

  expect(trailingCash(dividends, "2026-09-16")).toBe(24);
  expect(trailingCash(dividends, "2026-09-15")).toBe(21.5);
  expect(trailingCash([], "2026-09-16")).toBe(0);
});

test("cashGoneExBy counts the cash gone ex after the first day through each, so a span takes the difference", () => {
  const dates = ["2026-06-09", "2026-06-10", "2026-06-11", "2026-09-16"];

  const cash = cashGoneExBy(dates, [
    // Gone ex on the first day, so before any span from it starts.
    dividend(5, "2026-06-09"),
    dividend(6, "2026-06-11"),
    dividend(7, "2026-09-16"),
    dividend(7, null),
  ]);

  expect(cash).toEqual([0, 0, 6, 13]);
  // From the third day to the fourth only the last distribution went ex.
  expect(cash[3] - cash[2]).toBe(7);
  expect(cashGoneExBy([], [dividend(5, "2026-06-09")])).toEqual([]);
});

test("premium is the price over the net asset value less one, and a discount below it", () => {
  const nav = { date: "2026-10-16", value: 50 };

  expect(premium(51, nav)).toBeCloseTo(0.02);
  expect(premium(49.5, nav)).toBeCloseTo(-0.01);
  expect(premium(50, nav)).toBe(0);
});
