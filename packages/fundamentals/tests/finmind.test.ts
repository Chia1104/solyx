import { expect, test } from "vite-plus/test";

import { Market } from "@solyx/core/market";

import { createFinMind } from "../src/finmind.ts";

const TSMC = { market: Market.TW, symbol: "2330" };

/** Answers each request with the next body, as JSON with the status given beside it. */
function fakeFinMind(...answers: { status?: number; body: unknown }[]) {
  const sent: string[] = [];

  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    sent.push(new Request(input, init).url);

    const answer = answers.shift() ?? { body: { data: [] } };

    return Response.json(answer.body, { status: answer.status ?? 200 });
  };

  return { sent, finmind: createFinMind({ fetch }) };
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

test("a listing outside Taiwan has no fundamentals and costs no request", async () => {
  const { sent, finmind } = fakeFinMind();
  const apple = { market: Market.US, symbol: "AAPL" };

  expect(await finmind.getStatements(apple, "2025-01-01")).toEqual([]);
  expect(await finmind.getMonthlyRevenue(apple, "2025-01")).toEqual([]);
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
