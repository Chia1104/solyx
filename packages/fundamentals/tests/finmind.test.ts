import { expect, test } from "vite-plus/test";

import { Investor } from "@solyx/core/flows";
import { RestrictionKind } from "@solyx/core/fundamentals";
import { Market } from "@solyx/core/market";

import { FinMindPlan, createFinMind } from "../src/finmind.ts";

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

/** Answers each dataset with its rows, and none for a dataset not given. */
function fakeDatasets(
  access: { token?: string; plan?: FinMindPlan },
  datasets: Record<string, unknown[]>
) {
  const sent: string[] = [];
  const params: Record<string, string>[] = [];

  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(new Request(input, init).url);
    const dataset = url.searchParams.get("dataset") ?? "";

    sent.push(dataset);
    params.push(Object.fromEntries(url.searchParams));

    return Response.json({ msg: "success", data: datasets[dataset] ?? [] });
  };

  return {
    sent,
    params,
    finmind: createFinMind({
      fetch,
      token: async () => access.token,
      plan: () => access.plan ?? FinMindPlan.Free,
    }),
  };
}

const RESTRICTIONS = {
  TaiwanStockMarginShortSaleSuspension: [
    {
      stock_id: "2330",
      date: "2026-10-05",
      end_date: "2026-10-12",
      reason: "除息",
    },
    // Another listing's, which a dataset may answer with too.
    {
      stock_id: "0050",
      date: "2026-10-05",
      end_date: "2026-10-12",
      reason: "分配收益",
    },
  ],
  TaiwanStockDayTradingSuspension: [
    {
      stock_id: "2330",
      date: "2026-10-06",
      end_date: "2026-10-12",
      reason: "除息",
    },
  ],
  TaiwanStockDispositionSecuritiesPeriod: [
    {
      date: "2026-10-14",
      stock_id: "2330",
      stock_name: "台積電",
      disposition_cnt: 1,
      condition: "連續三次",
      measure: "第一次處置",
      period_start: "2026-10-15",
      period_end: "2026-10-28",
    },
  ],
  TaiwanStockSuspended: [
    {
      stock_id: "2330",
      date: "2026-10-01",
      suspension_time: "8:00",
      resumption_date: "2026-10-03",
      resumption_time: "8:00",
    },
    {
      stock_id: "2330",
      date: "2026-10-20",
      suspension_time: "10:30",
      resumption_date: "2026-10-20",
      resumption_time: "13:00",
    },
    {
      stock_id: "2330",
      date: "2026-10-30",
      suspension_time: "8:00",
      resumption_date: "",
      resumption_time: "",
    },
  ],
};

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

test("reads the days Taiwan's exchange trades from a day on, for every listing at once", async () => {
  const { sent, finmind } = fakeFinMind({
    body: {
      msg: "success",
      status: 200,
      data: [{ date: "2026-09-29" }, { date: "2026-09-25" }, { date: "unset" }],
    },
  });

  expect(await finmind.tradingDays(Market.TW, "2026-09-25")).toEqual([
    "2026-09-25",
    "2026-09-29",
  ]);
  expect(Object.fromEntries(new URL(sent[0]).searchParams)).toEqual({
    dataset: "TaiwanStockTradingDate",
    start_date: "2026-09-25",
  });
});

test("the free plan reads a listing's short-sale suspensions alone", async () => {
  const { sent, finmind } = fakeDatasets(
    { token: "fm-token", plan: FinMindPlan.Free },
    RESTRICTIONS
  );

  expect(await finmind.getRestrictions(TSMC, "2025-10-08")).toEqual([
    {
      kind: RestrictionKind.ShortSaleSuspension,
      from: "2026-10-05",
      until: "2026-10-12",
      note: "除息",
    },
  ]);
  expect(sent).toEqual(["TaiwanStockMarginShortSaleSuspension"]);
});

test("a paid plan also reads day-trading suspensions, dispositions and halts, each kept to the listing", async () => {
  const { sent, finmind } = fakeDatasets(
    { token: "fm-token", plan: FinMindPlan.Backer },
    RESTRICTIONS
  );

  expect(await finmind.getRestrictions(TSMC, "2025-10-08")).toEqual([
    // Halted through the day before trading resumed.
    {
      kind: RestrictionKind.Halt,
      from: "2026-10-01",
      until: "2026-10-02",
      note: null,
    },
    {
      kind: RestrictionKind.ShortSaleSuspension,
      from: "2026-10-05",
      until: "2026-10-12",
      note: "除息",
    },
    {
      kind: RestrictionKind.DayTradingSuspension,
      from: "2026-10-06",
      until: "2026-10-12",
      note: "除息",
    },
    {
      kind: RestrictionKind.Disposition,
      from: "2026-10-15",
      until: "2026-10-28",
      note: "第一次處置",
    },
    // Resumed the day it began.
    {
      kind: RestrictionKind.Halt,
      from: "2026-10-20",
      until: "2026-10-20",
      note: null,
    },
    // No day set to resume.
    {
      kind: RestrictionKind.Halt,
      from: "2026-10-30",
      until: null,
      note: null,
    },
  ]);
  expect(sent.toSorted()).toEqual(Object.keys(RESTRICTIONS).toSorted());
});

test("without a token a paid plan reads as the free one", async () => {
  const { sent, finmind } = fakeDatasets(
    { plan: FinMindPlan.Sponsor },
    RESTRICTIONS
  );

  await finmind.getRestrictions(TSMC, "2025-10-08");

  expect(sent).toEqual(["TaiwanStockMarginShortSaleSuspension"]);
});

test("outside Taiwan there is nothing to read, and it costs no request", async () => {
  const { sent, finmind } = fakeFinMind();
  const apple = { market: Market.US, symbol: "AAPL" };

  expect(await finmind.getStatements(apple, "2025-01-01")).toEqual([]);
  expect(await finmind.getMonthlyRevenue(apple, "2025-01")).toEqual([]);
  expect(await finmind.getDividends(apple, "2025-01-01")).toEqual([]);
  expect(await finmind.getRestrictions(apple, "2025-01-01")).toEqual([]);
  expect(await finmind.tradingDays(Market.US, "2025-01-01")).toEqual([]);
  expect(await finmind.getListingFlows(apple, "2025-01-01")).toEqual({
    trades: [],
    margin: [],
    foreign: [],
  });
  expect(await finmind.getMarketFlows(Market.US, "2025-01-01")).toEqual({
    trades: [],
    margin: [],
    futures: [],
  });
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

const trades = (date: string, name: string, buy: number, sell: number) => ({
  date,
  buy,
  name,
  sell,
});

const ofTsmc = <Row extends object>(row: Row) => ({ ...row, stock_id: "2330" });

test("reads a listing's flows in shares, a foreign group's dealers counted with it, and drops another listing's rows", async () => {
  const { sent, finmind } = fakeDatasets(
    {},
    {
      TaiwanStockInstitutionalInvestorsBuySell: [
        ofTsmc(trades("2026-10-08", "Foreign_Investor", 7_000, 19_000)),
        ofTsmc(trades("2026-10-08", "Foreign_Dealer_Self", 500, 0)),
        ofTsmc(trades("2026-10-08", "Investment_Trust", 800, 30)),
        ofTsmc(trades("2026-10-08", "Dealer_Hedging", 300, 60)),
        ofTsmc(trades("2026-10-07", "Foreign_Investor", 9_000, 11_000)),
        { ...trades("2026-10-08", "Foreign_Investor", 1, 0), stock_id: "0050" },
      ],
      TaiwanStockMarginPurchaseShortSale: [
        {
          date: "2026-10-08",
          stock_id: "2330",
          MarginPurchaseTodayBalance: 31_586,
          MarginPurchaseLimit: 6_483_092,
          ShortSaleTodayBalance: 45,
          Note: " ",
        },
      ],
      TaiwanStockShareholding: [
        {
          date: "2026-10-08",
          stock_id: "2330",
          ForeignInvestmentSharesRatio: 69.14,
          ForeignInvestmentUpperLimitRatio: 100,
        },
      ],
    }
  );

  expect(await finmind.getListingFlows(TSMC, "2026-08-09")).toEqual({
    trades: [
      {
        date: "2026-10-07",
        investor: Investor.Foreign,
        bought: 9_000,
        sold: 11_000,
      },
      {
        date: "2026-10-08",
        investor: Investor.Foreign,
        bought: 7_500,
        sold: 19_000,
      },
      {
        date: "2026-10-08",
        investor: Investor.InvestmentTrust,
        bought: 800,
        sold: 30,
      },
      {
        date: "2026-10-08",
        investor: Investor.DealerHedging,
        bought: 300,
        sold: 60,
      },
    ],
    margin: [
      {
        date: "2026-10-08",
        margin: 31_586_000,
        marginLimit: 6_483_092_000,
        short: 45_000,
      },
    ],
    foreign: [{ date: "2026-10-08", ratio: 0.6914, limit: 1 }],
  });
  expect(sent.toSorted()).toEqual([
    "TaiwanStockInstitutionalInvestorsBuySell",
    "TaiwanStockMarginPurchaseShortSale",
    "TaiwanStockShareholding",
  ]);
});

test("reads the market's flows: its groups' trades without the total, whole sessions of margin, and the index future's positions", async () => {
  const { params, finmind } = fakeDatasets(
    {},
    {
      TaiwanStockTotalInstitutionalInvestors: [
        trades("2026-10-08", "Foreign_Investor", 286e9, 361e9),
        trades("2026-10-08", "Dealer_self", 6e9, 9e9),
        trades("2026-10-08", "total", 340e9, 432e9),
      ],
      TaiwanStockTotalMarginPurchaseShortSale: [
        { date: "2026-10-08", name: "MarginPurchase", TodayBalance: 9_406_720 },
        { date: "2026-10-08", name: "ShortSale", TodayBalance: 211_949 },
        {
          date: "2026-10-08",
          name: "MarginPurchaseMoney",
          TodayBalance: 646_405_767_000,
        },
        // A session missing a balance.
        { date: "2026-10-07", name: "MarginPurchase", TodayBalance: 9_358_246 },
      ],
      TaiwanFuturesInstitutionalInvestors: [
        {
          futures_id: "TX",
          date: "2026-10-08",
          institutional_investors: "外資",
          long_open_interest_balance_volume: 11_389,
          short_open_interest_balance_volume: 94_583,
        },
        {
          futures_id: "TX",
          date: "2026-10-08",
          institutional_investors: "投信",
          long_open_interest_balance_volume: 79_091,
          short_open_interest_balance_volume: 2_752,
        },
      ],
    }
  );

  expect(await finmind.getMarketFlows(Market.TW, "2026-08-09")).toEqual({
    trades: [
      {
        date: "2026-10-08",
        investor: Investor.Foreign,
        bought: 286e9,
        sold: 361e9,
      },
      { date: "2026-10-08", investor: Investor.Dealer, bought: 6e9, sold: 9e9 },
    ],
    margin: [
      {
        date: "2026-10-08",
        marginValue: 646_405_767_000,
        margin: 9_406_720_000,
        short: 211_949_000,
      },
    ],
    futures: [
      {
        date: "2026-10-08",
        investor: Investor.Foreign,
        long: 11_389,
        short: 94_583,
      },
      {
        date: "2026-10-08",
        investor: Investor.InvestmentTrust,
        long: 79_091,
        short: 2_752,
      },
    ],
  });
  expect(params.toSorted((a, b) => a.dataset.localeCompare(b.dataset))).toEqual(
    [
      {
        dataset: "TaiwanFuturesInstitutionalInvestors",
        data_id: "TX",
        start_date: "2026-08-09",
      },
      {
        dataset: "TaiwanStockTotalInstitutionalInvestors",
        start_date: "2026-08-09",
      },
      {
        dataset: "TaiwanStockTotalMarginPurchaseShortSale",
        start_date: "2026-08-09",
      },
    ]
  );
});
