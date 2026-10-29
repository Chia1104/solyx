import { expect, test } from "vite-plus/test";

import { Investor } from "@solyx/core/flows";
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

/** Answers each dataset with its rows, and none for a dataset not given. */
function fakeDatasets(datasets: Record<string, unknown[]>) {
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
    finmind: createFinMind({ fetch }),
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

test("reads each quarter's balance sheet by its lines, a line it does not report left empty", async () => {
  const { sent, finmind } = fakeFinMind({
    body: {
      data: [
        line("2026-06-30", "CashAndCashEquivalents", 120),
        line("2026-06-30", "AccountsReceivableNet", 570),
        line("2026-06-30", "AccountsReceivableDuefromRelatedPartiesNet", 5),
        line("2026-06-30", "Inventories", 530),
        line("2026-06-30", "CurrentAssets", 1380),
        line("2026-06-30", "CurrentLiabilities", 1170),
        line("2026-06-30", "ShorttermBorrowings", 425),
        line("2026-06-30", "LongtermBorrowings", 58),
        line("2026-06-30", "BondsPayable", 48),
        line("2026-06-30", "TotalAssets", 1570),
        line("2026-06-30", "TotalAssets_per", 100),
        line("2026-06-30", "Liabilities", 1295),
        line("2026-06-30", "Equity", 275),
        // A financial holding reports no current lines, inventories or borrowings.
        line("2026-03-31", "CashAndCashEquivalents", 360),
        line("2026-03-31", "TotalAssets", 14_960),
        line("2026-03-31", "Liabilities", 13_830),
        line("2026-03-31", "Equity", 1130),
        // A quarter without total assets says nothing a balance sheet can hold.
        line("2025-12-31", "Equity", 1100),
      ],
    },
  });

  expect(await finmind.getBalanceSheets(TSMC, "2025-10-01")).toEqual([
    {
      periodEnd: "2026-03-31",
      totalAssets: 14_960,
      totalLiabilities: 13_830,
      equity: 1130,
      cash: 360,
      receivables: null,
      inventories: null,
      currentAssets: null,
      currentLiabilities: null,
      shortTermBorrowings: null,
      longTermBorrowings: null,
      bondsPayable: null,
    },
    {
      periodEnd: "2026-06-30",
      totalAssets: 1570,
      totalLiabilities: 1295,
      equity: 275,
      cash: 120,
      receivables: 575,
      inventories: 530,
      currentAssets: 1380,
      currentLiabilities: 1170,
      shortTermBorrowings: 425,
      longTermBorrowings: 58,
      bondsPayable: 48,
    },
  ]);
  expect(Object.fromEntries(new URL(sent[0]).searchParams)).toEqual({
    dataset: "TaiwanStockBalanceSheet",
    data_id: "2330",
    start_date: "2025-10-01",
  });
});

test("reads each quarter's cash flows alone from lines FinMind gives from the year's start", async () => {
  const operating = "CashFlowsFromOperatingActivities";
  const paid = "PropertyAndPlantAndEquipment";

  const { sent, finmind } = fakeFinMind({
    body: {
      data: [
        line("2025-03-31", operating, 600),
        line("2025-03-31", paid, -300),
        line("2025-06-30", operating, 1100),
        line("2025-06-30", paid, -620),
        line("2025-06-30", "CashProvidedByInvestingActivities", -700),
        line("2025-09-30", operating, 1500),
        line("2025-09-30", paid, -900),
        line("2025-09-30", "CashProvidedByInvestingActivities", -1000),
        line("2025-09-30", "CashFlowsProvidedFromFinancingActivities", -90),
        // The year's first quarter is its own figure.
        line("2026-03-31", operating, -140),
        line("2026-03-31", "CashFlowsProvidedFromFinancingActivities", 260),
        // The quarter before it is missing, so this one cannot be told alone.
        line("2026-09-30", operating, 900),
      ],
    },
  });

  expect(await finmind.getCashFlows(TSMC, "2025-06-01")).toEqual([
    {
      periodEnd: "2025-06-30",
      operating: 500,
      capitalExpenditure: 320,
      // The first quarter reports no investing line to take from the half year's.
      investing: null,
      financing: null,
    },
    {
      periodEnd: "2025-09-30",
      operating: 400,
      capitalExpenditure: 280,
      investing: -300,
      financing: null,
    },
    {
      periodEnd: "2026-03-31",
      operating: -140,
      capitalExpenditure: null,
      investing: null,
      financing: 260,
    },
  ]);
  expect(Object.fromEntries(new URL(sent[0]).searchParams)).toEqual({
    dataset: "TaiwanStockCashFlowsStatement",
    data_id: "2330",
    start_date: "2025-01-01",
  });
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

test("reads a fund's distributions, which carry no announcement, by the date FinMind gives them", async () => {
  const distribution = (date: string, cash: number, ex: string) => ({
    date,
    stock_id: "0050",
    year: "115",
    StockEarningsDistribution: 0,
    StockStatutorySurplus: 0,
    StockExDividendTradingDate: "",
    CashEarningsDistribution: cash,
    CashStatutorySurplus: 0,
    CashExDividendTradingDate: ex,
    CashDividendPaymentDate: "",
    AnnouncementDate: "",
    AnnouncementTime: "",
  });

  const { finmind } = fakeFinMind({
    body: {
      data: [
        distribution("2026-07-27", 0.6, "2026-07-21"),
        distribution("2026-01-28", 1, "2026-01-22"),
      ],
    },
  });

  expect(
    await finmind.getDividends(
      { market: Market.TW, symbol: "0050" },
      "2026-01-01"
    )
  ).toEqual([
    {
      period: "115",
      announced: null,
      cash: 1,
      stock: 0,
      cashExDate: "2026-01-22",
      cashPaidOn: null,
      stockExDate: null,
    },
    {
      period: "115",
      announced: null,
      cash: 0.6,
      stock: 0,
      cashExDate: "2026-07-21",
      cashPaidOn: null,
      stockExDate: null,
    },
  ]);
});

test("fails when none of a dataset's rows read, rather than answer that nothing is filed", async () => {
  const { finmind } = fakeFinMind({
    body: { data: [{ date: "2026-06-30", type: "Revenue", value: "n/a" }] },
  });

  await expect(finmind.getStatements(TSMC, "2026-01-01")).rejects.toThrow(
    "FinMind: none of the 1 rows of TaiwanStockFinancialStatements read as expected"
  );
});

test("reads the days Taiwan's exchange trades from a day on, for every listing at once", async () => {
  const { sent, finmind } = fakeFinMind({
    body: {
      msg: "success",
      status: 200,
      data: [{ date: "2026-09-29" }, { date: "2026-09-25" }, { date: "unset" }],
    },
  });

  expect(await finmind.tradingDays(Market.TW, "2026-09-25")).toEqual({
    trading: ["2026-09-25", "2026-09-29"],
    earlyCloses: [],
  });
  expect(Object.fromEntries(new URL(sent[0]).searchParams)).toEqual({
    dataset: "TaiwanStockTradingDate",
    start_date: "2026-09-25",
  });
});

test("reads the TAIEX's total return index from a day on, oldest first", async () => {
  const { sent, finmind } = fakeFinMind({
    body: {
      msg: "success",
      status: 200,
      data: [
        { date: "2026-10-29", stock_id: "TAIEX", price: 107221.75 },
        { date: "2026-10-28", stock_id: "TAIEX", price: 108763.96 },
        { date: "unset", stock_id: "TAIEX", price: 1 },
      ],
    },
  });

  expect(await finmind.getTotalReturn(Market.TW, "2026-10-28")).toEqual([
    { date: "2026-10-28", close: 108763.96 },
    { date: "2026-10-29", close: 107221.75 },
  ]);
  expect(Object.fromEntries(new URL(sent[0]).searchParams)).toEqual({
    dataset: "TaiwanStockTotalReturnIndex",
    data_id: "TAIEX",
    start_date: "2026-10-28",
  });
});

test("outside Taiwan there is nothing to read, and it costs no request", async () => {
  const { sent, finmind } = fakeFinMind();
  const apple = { market: Market.US, symbol: "AAPL" };

  expect(await finmind.getStatements(apple, "2025-01-01")).toEqual([]);
  expect(await finmind.getMonthlyRevenue(apple, "2025-01")).toEqual([]);
  expect(await finmind.getDividends(apple, "2025-01-01")).toEqual([]);
  expect(await finmind.tradingDays(Market.US, "2025-01-01")).toEqual({
    trading: [],
    earlyCloses: [],
  });
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
  expect(await finmind.getTotalReturn(Market.US, "2025-01-01")).toEqual([]);
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
  const { sent, finmind } = fakeDatasets({
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
  });

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
  const { params, finmind } = fakeDatasets({
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
  });

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
