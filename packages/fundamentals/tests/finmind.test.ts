import { expect, test } from "vite-plus/test";

import { Market } from "@solyx/core/market";

import { createFinMind } from "../src/finmind.ts";

const TSMC = { market: Market.TW, symbol: "2330" };

/** Answers each request with the next body, as JSON with the status given beside it. */
function fakeFinMind(...answers: { status?: number; body: unknown }[]) {
  return fakeFinMindOn(undefined, ...answers);
}

function fakeFinMindOn(
  token: string | undefined,
  ...answers: { status?: number; body: unknown }[]
) {
  const sent: string[] = [];
  const authorizations: (string | null)[] = [];

  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);

    sent.push(request.url);
    authorizations.push(request.headers.get("authorization"));

    const answer = answers.shift() ?? { body: { data: [] } };

    return Response.json(answer.body, { status: answer.status ?? 200 });
  };

  return {
    sent,
    authorizations,
    finmind: createFinMind({ fetch, token: async () => token }),
  };
}

const line = (date: string, type: string, value: number) => ({
  date,
  stock_id: "2330",
  type,
  value,
  origin_name: type,
});

test("groups a listing's statement lines into quarters, oldest first, each due on its filing deadline", async () => {
  const { sent, finmind } = fakeFinMind({
    body: {
      msg: "success",
      status: 200,
      data: [
        line("2026-06-30", "Revenue", 1_270_000),
        line("2026-06-30", "GrossProfit", 760_000),
        line("2026-06-30", "OperatingIncome", 640_000),
        line("2026-06-30", "IncomeAfterTaxes", 541_000),
        line("2026-06-30", "EquityAttributableToOwnersOfParent", 540_000),
        line("2026-06-30", "EPS", 27.25),
        line("2026-03-31", "Revenue", 1_134_000),
        line("2026-03-31", "EPS", 22.08),
        // A quarter without revenue says nothing a statement can hold.
        line("2025-12-31", "EPS", 19.51),
        { date: "2026-06-30", type: "TAX" },
      ],
    },
  });

  expect(await finmind.getStatements(TSMC, "2025-10-01")).toEqual([
    {
      periodEnd: "2026-03-31",
      knownFrom: "2026-05-15",
      revenue: 1_134_000,
      grossProfit: null,
      operatingIncome: null,
      netIncome: null,
      eps: 22.08,
    },
    {
      periodEnd: "2026-06-30",
      knownFrom: "2026-08-14",
      revenue: 1_270_000,
      grossProfit: 760_000,
      operatingIncome: 640_000,
      netIncome: 540_000,
      eps: 27.25,
    },
  ]);

  const url = new URL(sent[0]);

  expect(url.origin + url.pathname).toBe(
    "https://api.finmindtrade.com/api/v4/data"
  );
  expect(Object.fromEntries(url.searchParams)).toEqual({
    dataset: "TaiwanStockFinancialStatements",
    data_id: "2330",
    start_date: "2025-10-01",
  });
});

test("net income falls back to the whole group's where the parent's is not named", async () => {
  const { finmind } = fakeFinMind({
    body: {
      data: [
        line("2026-06-30", "Revenue", 100),
        line("2026-06-30", "IncomeAfterTax", 30),
      ],
    },
  });

  expect((await finmind.getStatements(TSMC, "2026-01-01"))[0].netIncome).toBe(
    30
  );
});

test("reads each month from its own fields rather than the day it was announced", async () => {
  const month = (date: string, year: number, monthOfYear: number) => ({
    date,
    stock_id: "2330",
    revenue: year * 100 + monthOfYear,
    revenue_year: year,
    revenue_month: monthOfYear,
  });

  const { sent, finmind } = fakeFinMind({
    body: {
      data: [
        month("2026-09-01", 2026, 8),
        // Announced in the first month asked for, but about the month before it.
        month("2026-07-01", 2026, 6),
        month("2026-08-01", 2026, 7),
      ],
    },
  });

  expect(await finmind.getMonthlyRevenue(TSMC, "2026-07")).toEqual([
    { month: "2026-07", revenue: 202607 },
    { month: "2026-08", revenue: 202608 },
  ]);
  expect(new URL(sent[0]).searchParams.get("start_date")).toBe("2026-07-01");
});

test("reads each distribution's cash and stock per share and its days, those still to go ex among them", async () => {
  const distribution = (
    announced: string,
    patch: Record<string, string | number> = {}
  ) => ({
    date: "2026-11-03",
    stock_id: "2330",
    year: "115年第2季",
    StockEarningsDistribution: 0,
    StockStatutorySurplus: 0,
    StockExDividendTradingDate: "",
    CashEarningsDistribution: 0,
    CashStatutorySurplus: 0,
    CashExDividendTradingDate: "",
    CashDividendPaymentDate: "",
    TotalNumberOfCashCapitalIncrease: 0,
    AnnouncementDate: announced,
    AnnouncementTime: "17:50:47",
    ...patch,
  });

  const { sent, finmind } = fakeFinMind({
    body: {
      data: [
        distribution("2026-09-29", {
          year: "114年",
          StockEarningsDistribution: 0.8,
          StockExDividendTradingDate: "2026-10-06",
          CashEarningsDistribution: 0.3,
          CashStatutorySurplus: 0.1,
          CashExDividendTradingDate: "2026-10-06",
          CashDividendPaymentDate: "2026-11-23",
        }),
        distribution("2026-08-25", {
          CashEarningsDistribution: 0.6,
          CashExDividendTradingDate: "2026-10-28",
        }),
        // A cash capital increase alone distributes nothing.
        distribution("2026-09-01", { TotalNumberOfCashCapitalIncrease: 1e8 }),
        // Announced before the day asked from, though it went ex after.
        distribution("2026-07-30", { CashEarningsDistribution: 1 }),
        distribution("2026-09-10", { AnnouncementDate: "" }),
      ],
    },
  });

  expect(await finmind.getDividends(TSMC, "2026-08-01")).toEqual([
    {
      period: "115年第2季",
      announced: "2026-08-25",
      cash: 0.6,
      stock: 0,
      cashExDate: "2026-10-28",
      cashPaidOn: null,
      stockExDate: null,
    },
    {
      period: "114年",
      announced: "2026-09-29",
      cash: 0.4,
      stock: 0.8,
      cashExDate: "2026-10-06",
      cashPaidOn: "2026-11-23",
      stockExDate: "2026-10-06",
    },
  ]);
  expect(Object.fromEntries(new URL(sent[0]).searchParams)).toEqual({
    dataset: "TaiwanStockDividend",
    data_id: "2330",
    start_date: "2026-08-01",
  });
});

test("a listing outside Taiwan has no fundamentals and costs no request", async () => {
  const { sent, finmind } = fakeFinMind();
  const apple = { market: Market.US, symbol: "AAPL" };

  expect(await finmind.getStatements(apple, "2025-01-01")).toEqual([]);
  expect(await finmind.getMonthlyRevenue(apple, "2025-01")).toEqual([]);
  expect(await finmind.getDividends(apple, "2025-01-01")).toEqual([]);
  expect(sent).toEqual([]);
});

test("a failure names FinMind and the reason it gives", async () => {
  const { finmind } = fakeFinMind({
    status: 402,
    body: { msg: "Requests reach the upper limit.", status: 402 },
  });

  await expect(finmind.getStatements(TSMC, "2025-01-01")).rejects.toThrow(
    "FinMind answered 402: Requests reach the upper limit."
  );
});

test("a saved token goes with every request, and none without one", async () => {
  const anonymous = fakeFinMind({ body: { data: [] } });
  const registered = fakeFinMindOn("fm-token", { body: { data: [] } });

  await anonymous.finmind.getStatements(TSMC, "2025-01-01");
  await registered.finmind.getStatements(TSMC, "2025-01-01");

  expect(anonymous.authorizations).toEqual([null]);
  expect(registered.authorizations).toEqual(["Bearer fm-token"]);
});
