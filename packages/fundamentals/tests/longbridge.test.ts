import { expect, test } from "vite-plus/test";

import { Market, exchangeMidnight } from "@solyx/core/market";
import { createLongbridge } from "@solyx/longbridge/client";

import { createLongbridgeFundamentals } from "../src/longbridge.ts";

const APPLE = { market: Market.US, symbol: "AAPL" };

const TOKEN = "hk_access";

/** UTC seconds of New York's midnight starting `date`, as Longbridge dates a period's last day. */
const periodEnd = (date: string) => String(exchangeMidnight(Market.US, date));

interface Line {
  field: string;
  values: { period: string; date: string; value: string }[];
}

/** A report as Longbridge groups it: lines under indicators under a kind. */
const report = (kind: string, lines: Line[]) => ({
  list: {
    [kind]: {
      indicators: lines.map(({ field, values }) => ({
        title: field,
        currency: "USD",
        accounts: [
          {
            field,
            name: field,
            values: values.map(({ period, date, value }) => ({
              period,
              year: Number(period.slice(-4)),
              fp_end: periodEnd(date),
              value,
              ratio: "",
              yoy: "",
            })),
          },
        ],
      })),
    },
  },
});

const action = (id: string, kind: string, date: string) => ({
  id,
  action: kind,
  act_type: "",
  act_desc: "",
  date,
  date_type: "",
  date_zone: "EST",
});

/** What the fake server answers each of Longbridge's paths with; a refusal as an error. */
interface Answers {
  reports?: ReturnType<typeof report> | Error;
  dividends?: { list: object[] };
  actions?: { items: object[] };
}

const RATE_LIMITED = "已達到 1S 區間調用上限，請 0.2 秒後重試";

/** Answers each path with its data in Longbridge's envelope, the first `limited` requests with a 429, and records what was asked. */
function fakeLongbridge(answers: Answers, { limited = 0 } = {}) {
  const asked: {
    path: string;
    params: Record<string, string>;
    headers: Headers;
  }[] = [];

  const byPath = new Map<string, Answers[keyof Answers]>([
    ["/v1/quote/financial-reports", answers.reports],
    ["/v1/quote/dividends", answers.dividends],
    ["/v1/quote/company-act", answers.actions],
  ]);

  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);
    const url = new URL(request.url);

    asked.push({
      path: url.pathname,
      params: Object.fromEntries(url.searchParams),
      headers: request.headers,
    });

    if (asked.length <= limited) {
      return Response.json(
        { code: 429_001, message: RATE_LIMITED, data: null },
        { status: 429, headers: { "retry-after": "0" } }
      );
    }

    const answer = byPath.get(url.pathname);

    return Response.json(
      answer instanceof Error
        ? { code: 301_600, message: answer.message, data: null }
        : { code: 0, message: "success", data: answer }
    );
  };

  return {
    asked,
    longbridge: createLongbridgeFundamentals({
      api: createLongbridge({ accessToken: async () => TOKEN, fetch }),
    }),
  };
}

const RELEASES = {
  items: [
    action("r1", "FinancialReport", "20260731"),
    action("r2", "FinancialReport", "20260130"),
    // The next quarter's release, expected, dates none of these.
    action("r3", "ReportDate", "20261030"),
  ],
};

test("a quarter's statement is that quarter alone, dated by the release of its results", async () => {
  const { longbridge, asked } = fakeLongbridge({
    reports: report("IS", [
      {
        field: "OperatingRevenue",
        values: [
          { period: "Q3 2026", date: "2026-06-27", value: "109417000000.0000" },
          { period: "Q1 2026", date: "2025-12-27", value: "143756000000.0000" },
          { period: "Q4 2025", date: "2025-09-27", value: "102466000000.0000" },
          // A quarter without revenue is dropped.
          { period: "Q2 2026", date: "2026-03-28", value: "" },
        ],
      },
      {
        field: "GrossMgn",
        values: [
          { period: "Q3 2026", date: "2026-06-27", value: "50.0000" },
          { period: "Q1 2026", date: "2025-12-27", value: "48.0000" },
        ],
      },
      {
        field: "OperatingIncome",
        values: [
          { period: "Q3 2026", date: "2026-06-27", value: "35695000000.0000" },
        ],
      },
      {
        field: "NetProfit",
        values: [
          { period: "Q3 2026", date: "2026-06-27", value: "29789000000.0000" },
        ],
      },
      {
        field: "EPS",
        values: [{ period: "Q3 2026", date: "2026-06-27", value: "2.0200" }],
      },
    ]),
    actions: RELEASES,
  });

  const statements = await longbridge.getStatements(APPLE, "2025-07-01");

  expect(statements).toEqual([
    {
      periodEnd: "2025-09-27",
      // No release came within the 10-K's 90 days, so the deadline stands.
      knownFrom: "2025-12-26",
      revenue: 102_466_000_000,
      grossProfit: null,
      operatingIncome: null,
      netIncome: null,
      eps: null,
    },
    {
      periodEnd: "2025-12-27",
      knownFrom: "2026-01-30",
      revenue: 143_756_000_000,
      grossProfit: 69_002_880_000,
      operatingIncome: null,
      netIncome: null,
      eps: null,
    },
    {
      periodEnd: "2026-06-27",
      knownFrom: "2026-07-31",
      revenue: 109_417_000_000,
      grossProfit: 54_708_500_000,
      operatingIncome: 35_695_000_000,
      netIncome: 29_789_000_000,
      eps: 2.02,
    },
  ]);

  const reports = asked.find(({ path }) => path.endsWith("financial-reports"));

  expect(reports?.params).toEqual({
    symbol: "AAPL.US",
    kind: "IS",
    report: "qf",
  });
  expect(reports?.headers.get("authorization")).toBe(`Bearer ${TOKEN}`);
  expect(reports?.headers.get("x-dc-region")).toBe("ap");
  expect(reports?.headers.get("accept-language")).toBe("zh-HK");
});

test("a quarter without a release within 45 days is dated by the 10-Q's deadline", async () => {
  const { longbridge } = fakeLongbridge({
    reports: report("IS", [
      {
        field: "OperatingRevenue",
        values: [
          { period: "Q2 2026", date: "2026-03-28", value: "95000000000" },
        ],
      },
    ]),
    actions: RELEASES,
  });

  // The first release after the quarter, on 2026-07-31, is the next quarter's.
  expect(await longbridge.getStatements(APPLE, "2026-01-01")).toMatchObject([
    { periodEnd: "2026-03-28", knownFrom: "2026-05-12" },
  ]);
});

test("a balance sheet holds what Longbridge gives, its equity what assets leave over liabilities", async () => {
  const { longbridge } = fakeLongbridge({
    reports: report("BS", [
      {
        field: "TotalAssets",
        values: [
          { period: "Q3 2026", date: "2026-06-27", value: "383266000000.0000" },
        ],
      },
      {
        field: "TotalLiability",
        values: [
          { period: "Q3 2026", date: "2026-06-27", value: "275746000000.0000" },
          // A sheet without total assets is dropped.
          { period: "Q2 2026", date: "2026-03-28", value: "280000000000.0000" },
        ],
      },
      {
        field: "CashSTInvest",
        values: [
          { period: "Q3 2026", date: "2026-06-27", value: "62399000000.0000" },
        ],
      },
      {
        field: "TotalReceiv",
        values: [
          { period: "Q3 2026", date: "2026-06-27", value: "58907000000.0000" },
        ],
      },
      {
        field: "Inventory",
        values: [
          { period: "Q3 2026", date: "2026-06-27", value: "11092000000.0000" },
        ],
      },
    ]),
  });

  expect(await longbridge.getBalanceSheets(APPLE, "2026-01-01")).toEqual([
    {
      periodEnd: "2026-06-27",
      totalAssets: 383_266_000_000,
      totalLiabilities: 275_746_000_000,
      equity: 107_520_000_000,
      // Longbridge's cash holds short-term investments too.
      cash: null,
      receivables: 58_907_000_000,
      inventories: 11_092_000_000,
      currentAssets: null,
      currentLiabilities: null,
      shortTermBorrowings: null,
      longTermBorrowings: null,
      bondsPayable: null,
    },
  ]);
});

test("a quarter's cash flows count what was paid for assets as a positive amount", async () => {
  const { longbridge, asked } = fakeLongbridge({
    reports: report("CF", [
      {
        field: "NetOperateCashFlow",
        values: [
          { period: "Q3 2026", date: "2026-06-27", value: "34369000000.0000" },
        ],
      },
      {
        field: "CapEx",
        values: [
          { period: "Q3 2026", date: "2026-06-27", value: "-2455000000.0000" },
        ],
      },
      {
        field: "NetInvestCashFlow",
        values: [
          { period: "Q3 2026", date: "2026-06-27", value: "-7757000000.0000" },
        ],
      },
      {
        field: "NetFinanceCashFlow",
        values: [
          { period: "Q3 2026", date: "2026-06-27", value: "-32640000000.0000" },
        ],
      },
    ]),
  });

  expect(await longbridge.getCashFlows(APPLE, "2026-01-01")).toEqual([
    {
      periodEnd: "2026-06-27",
      operating: 34_369_000_000,
      capitalExpenditure: 2_455_000_000,
      investing: -7_757_000_000,
      financing: -32_640_000_000,
    },
  ]);
  expect(asked[0].params.kind).toBe("CF");
});

test("a distribution pays the cash its description names, announced on the first of its days", async () => {
  const { longbridge } = fakeLongbridge({
    dividends: {
      list: [
        {
          id: "640389",
          desc: "每股派息 0.27 USD",
          ex_date: "2026.08.10",
          record_date: "2026.08.10",
          payment_date: "2026.08.13",
        },
        {
          id: "608936",
          desc: "每股派息 0.26 USD",
          ex_date: "2026.02.09",
          record_date: "2026.02.09",
          payment_date: "2026.02.12",
        },
        // Before the day asked from.
        {
          id: "300001",
          desc: "每股派息 0.24 USD",
          ex_date: "2024.02.09",
          record_date: "2024.02.09",
          payment_date: "2024.02.15",
        },
        // Nothing paid in dollars, so no distribution to count.
        {
          id: "300002",
          desc: "供股",
          ex_date: "2026.03.02",
          record_date: "",
          payment_date: "",
        },
      ],
    },
    actions: {
      items: [
        action("640389", "DividendExDate", "20260813"),
        action("640389", "DividendExDate", "20260810"),
        action("640389", "DividendExDate", "20260730"),
        action("r1", "FinancialReport", "20260730"),
      ],
    },
  });

  expect(await longbridge.getDividends(APPLE, "2025-01-01")).toEqual([
    {
      period: "每股派息 0.26 USD",
      announced: null,
      cash: 0.26,
      stock: 0,
      cashExDate: "2026-02-09",
      cashPaidOn: "2026-02-12",
      stockExDate: null,
    },
    {
      period: "每股派息 0.27 USD",
      announced: "2026-07-30",
      cash: 0.27,
      stock: 0,
      cashExDate: "2026-08-10",
      cashPaidOn: "2026-08-13",
      stockExDate: null,
    },
  ]);
});

test("the days a company's coming results are expected come from its corporate actions, soonest first", async () => {
  const { longbridge } = fakeLongbridge({
    actions: {
      items: [
        action("e2", "ReportDate", "20270128"),
        action("e1", "ReportDate", "20261030"),
        action("e1", "ReportDate", "20261030"),
        // Results already out date no expected release.
        action("r1", "FinancialReport", "20260730"),
      ],
    },
  });

  expect(await longbridge.getReportDates(APPLE)).toEqual([
    "2026-10-30",
    "2027-01-28",
  ]);
});

test("a US listing has no monthly revenue", async () => {
  const { longbridge, asked } = fakeLongbridge({});

  expect(await longbridge.getMonthlyRevenue(APPLE, "2025-01")).toEqual([]);
  expect(asked).toEqual([]);
});

test("a refusal names Longbridge and its reason, and a listing of another market asks nothing", async () => {
  const { longbridge, asked } = fakeLongbridge({
    reports: new Error("invalid symbol"),
  });

  await expect(longbridge.getCashFlows(APPLE, "2026-01-01")).rejects.toThrow(
    "Longbridge refused the statements of AAPL: invalid symbol"
  );

  await expect(
    longbridge.getCashFlows({ market: Market.TW, symbol: "2330" }, "2026-01-01")
  ).rejects.toThrow("Longbridge has no fundamentals for TW");
  expect(asked).toHaveLength(1);
});

test("a request Longbridge refuses as too frequent is tried again, and one refused every time names its reason", async () => {
  const cashFlows = report("CF", [
    {
      field: "NetOperateCashFlow",
      values: [{ period: "Q3 2026", date: "2026-06-27", value: "1" }],
    },
  ]);

  const briefly = fakeLongbridge({ reports: cashFlows }, { limited: 2 });

  expect(
    await briefly.longbridge.getCashFlows(APPLE, "2026-01-01")
  ).toHaveLength(1);
  expect(briefly.asked).toHaveLength(3);

  const always = fakeLongbridge({ reports: cashFlows }, { limited: 99 });

  await expect(
    always.longbridge.getCashFlows(APPLE, "2026-01-01")
  ).rejects.toThrow(
    `Longbridge refused the statements of AAPL: ${RATE_LIMITED}`
  );
  expect(always.asked).toHaveLength(5);
});

test("a row that does not read is dropped, but an answer none of whose rows read fails", async () => {
  const { longbridge } = fakeLongbridge({
    dividends: {
      list: [
        {
          id: "1",
          desc: "每股派息 0.27 USD",
          ex_date: "2026.08.10",
          payment_date: "",
        },
        { id: 2, desc: null },
      ],
    },
    actions: { items: [] },
  });

  expect(await longbridge.getDividends(APPLE, "2026-01-01")).toHaveLength(1);

  const broken = fakeLongbridge({
    dividends: { list: [{ id: 2 }] },
    actions: { items: [] },
  });

  await expect(
    broken.longbridge.getDividends(APPLE, "2026-01-01")
  ).rejects.toThrow("none of the 1 rows of the distributions of AAPL");
});

test("a read while signed out fails with the sign-in's reason", async () => {
  const longbridge = createLongbridgeFundamentals({
    api: createLongbridge({
      accessToken: async () => {
        throw new Error(
          "Sign in to Longbridge in Settings for US quotes and fundamentals"
        );
      },
    }),
  });

  await expect(longbridge.getStatements(APPLE, "2026-01-01")).rejects.toThrow(
    "Sign in to Longbridge"
  );
});
