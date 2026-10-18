import { expect, test, vi } from "vite-plus/test";

import { RestrictionKind } from "@solyx/core/fundamentals";
import type {
  ExchangeListsProvider,
  FundReportsProvider,
  FundamentalsProvider,
} from "@solyx/core/fundamentals";
import { Market } from "@solyx/core/market";
import { HOUR_MS } from "@solyx/utils/date";
import { memoryAnswers } from "@solyx/utils/fresh";

import { createFundamentals } from "../src/main/modules/fundamentals/fundamentals.ts";

const TSMC = { market: Market.TW, symbol: "2330" };

const TAIWAN_50 = { market: Market.TW, symbol: "0050" };

const PRICE_LIMITS = {
  after: "2026-10-06",
  band: { low: 882, high: 1070 },
};

const SHORT_SALE = {
  kind: RestrictionKind.ShortSaleSuspension,
  from: "2026-10-05",
  until: "2026-10-12",
  note: "除息",
};

const INDEX_FUND = {
  name: "範例台灣卓越50證券投資信託基金",
  category: "國內成分證券指數股票型基金",
  index: "臺灣50指數",
  benchmark: null,
  foreignHoldings: false,
  manager: "王小明",
  listedOn: "2003-06-30",
  units: 22_239_000_000,
  asOf: "2026-10-06",
};

const NET_ASSET_VALUE = { date: "2026-10-06", value: 108.62 };

const FUND_COSTS = {
  month: "2026-09",
  management: 0.00564,
  custody: 0.00222,
  guarantee: 0,
  commission: 0.00055,
  tax: 0.00144,
  other: 0.00396,
  total: 0.01382,
};

const DISPOSITION = {
  kind: RestrictionKind.Disposition,
  from: "2026-10-08",
  until: "2026-10-15",
  note: "第一次處置：連續三次",
};

const MULTIPLES = {
  asOf: "2026-10-06",
  priceToEarnings: 29.56,
  dividendYield: 0.86,
  priceToBook: 10.28,
};

const EX_NOTICE = {
  date: "2026-10-21",
  exDividend: true,
  exRights: false,
  cash: null,
};

const MEETING = { date: "2026-11-19", regular: false, election: true };

const CHIPS = { code: "24", name: "半導體業" };

function setup(answers = memoryAnswers()) {
  // 2026-10-07 10:00 in Taipei.
  const clock = { now: Date.parse("2026-10-07T02:00:00Z") };

  const provider = {
    id: "fake",
    markets: [Market.TW],
    getStatements: vi.fn<FundamentalsProvider["getStatements"]>(async () => []),
    getBalanceSheets: vi.fn<FundamentalsProvider["getBalanceSheets"]>(
      async () => []
    ),
    getCashFlows: vi.fn<FundamentalsProvider["getCashFlows"]>(async () => []),
    getMonthlyRevenue: vi.fn<FundamentalsProvider["getMonthlyRevenue"]>(
      async () => []
    ),
    getDividends: vi.fn<FundamentalsProvider["getDividends"]>(async () => []),
  };

  const lists = {
    id: "fake-lists",
    markets: [Market.TW],
    getRestrictions: vi.fn<ExchangeListsProvider["getRestrictions"]>(
      async () => [
        { symbol: "2330", ...SHORT_SALE },
        { symbol: "0050", ...SHORT_SALE },
        { symbol: "2330", ...DISPOSITION },
      ]
    ),
    getFunds: vi.fn<ExchangeListsProvider["getFunds"]>(async () => [
      { symbol: "0050", ...INDEX_FUND },
    ]),
    getMultiples: vi.fn<ExchangeListsProvider["getMultiples"]>(async () => [
      { symbol: "2330", ...MULTIPLES },
      // Its industry's others: one with every multiple, one at a loss, and one none are worked out for.
      { symbol: "2303", ...MULTIPLES, priceToEarnings: 12, priceToBook: 1.5 },
      { symbol: "2454", ...MULTIPLES, priceToEarnings: null, priceToBook: 4 },
      // Another industry's, which is no peer.
      { symbol: "1101", ...MULTIPLES, priceToEarnings: 99, priceToBook: 99 },
    ]),
    getExNotices: vi.fn<ExchangeListsProvider["getExNotices"]>(async () => [
      { symbol: "0050", ...EX_NOTICE },
    ]),
    getMeetings: vi.fn<ExchangeListsProvider["getMeetings"]>(async () => [
      { symbol: "2330", ...MEETING },
    ]),
    getIndustries: vi.fn<ExchangeListsProvider["getIndustries"]>(async () => [
      { symbol: "2330", ...CHIPS },
      { symbol: "2303", ...CHIPS },
      { symbol: "2454", ...CHIPS },
      { symbol: "3711", ...CHIPS },
      { symbol: "1101", code: "01", name: "水泥工業" },
    ]),
    getPriceLimits: vi.fn<ExchangeListsProvider["getPriceLimits"]>(async () => [
      { symbol: "2330", ...PRICE_LIMITS },
    ]),
  };

  const reports = {
    id: "fake-reports",
    markets: [Market.TW],
    getNetAssetValues: vi.fn<FundReportsProvider["getNetAssetValues"]>(
      async () => [{ symbol: "0050", ...NET_ASSET_VALUE }]
    ),
    getCosts: vi.fn<FundReportsProvider["getCosts"]>(async () => [
      { symbol: "0050", ...FUND_COSTS },
    ]),
  };

  const fundamentals = createFundamentals({
    providers: [provider],
    exchanges: [lists],
    fundReports: [reports],
    answers,
    now: () => new Date(clock.now),
  });

  return { clock, provider, lists, reports, fundamentals };
}

test("asks the market's provider for five years of quarters and dividends, and three of balance sheets, cash flows and months", async () => {
  const { provider, fundamentals } = setup();

  await fundamentals.statements(TSMC);
  await fundamentals.balanceSheets(TSMC);
  await fundamentals.cashFlows(TSMC);
  await fundamentals.monthlyRevenue(TSMC);
  await fundamentals.dividends(TSMC);

  expect(provider.getStatements).toHaveBeenCalledWith(TSMC, "2021-10-07");
  expect(provider.getBalanceSheets).toHaveBeenCalledWith(TSMC, "2023-10-07");
  expect(provider.getCashFlows).toHaveBeenCalledWith(TSMC, "2023-10-07");
  expect(provider.getMonthlyRevenue).toHaveBeenCalledWith(TSMC, "2023-10");
  expect(provider.getDividends).toHaveBeenCalledWith(TSMC, "2021-10-07");
});

test("names the provider that covers a market, and none for a market without one", () => {
  const { fundamentals } = setup();

  expect(fundamentals.source(Market.TW)).toBe("fake");
  expect(fundamentals.source(Market.US)).toBeUndefined();
});

test("keeps a listing's answer for half a day", async () => {
  const { clock, provider, fundamentals } = setup();

  await fundamentals.statements(TSMC);
  clock.now += 11 * HOUR_MS;
  await fundamentals.statements(TSMC);

  expect(provider.getStatements).toHaveBeenCalledTimes(1);

  clock.now += 2 * HOUR_MS;
  await fundamentals.statements(TSMC);

  expect(provider.getStatements).toHaveBeenCalledTimes(2);
});

test("an answer kept serves the next run over the same answers", async () => {
  const answers = memoryAnswers();
  const { fundamentals } = setup(answers);

  await fundamentals.statements(TSMC);

  const next = setup(answers);

  await next.fundamentals.statements(TSMC);

  expect(next.provider.getStatements).not.toHaveBeenCalled();
});

test("asks again after a failure", async () => {
  const { provider, fundamentals } = setup();

  provider.getStatements.mockRejectedValueOnce(
    new Error("FinMind answered 402")
  );

  await expect(fundamentals.statements(TSMC)).rejects.toThrow("402");
  await fundamentals.statements(TSMC);

  expect(provider.getStatements).toHaveBeenCalledTimes(2);
});

test("a market no provider covers has no fundamentals", async () => {
  const { provider, fundamentals } = setup();

  expect(
    await fundamentals.statements({ market: Market.US, symbol: "AAPL" })
  ).toEqual([]);
  expect(provider.getStatements).not.toHaveBeenCalled();
});

test("a listing's restrictions are its own among those its market's exchanges list, read for every listing at once and once an hour at most", async () => {
  const { clock, lists, fundamentals } = setup();

  expect(await fundamentals.restrictions(TSMC)).toEqual([
    SHORT_SALE,
    DISPOSITION,
  ]);
  expect(await fundamentals.restrictions(TAIWAN_50)).toEqual([SHORT_SALE]);
  expect(lists.getRestrictions).toHaveBeenCalledExactlyOnceWith(Market.TW);

  clock.now += HOUR_MS - 1;
  await fundamentals.restrictions(TSMC);

  expect(lists.getRestrictions).toHaveBeenCalledTimes(1);

  clock.now += 1;
  await fundamentals.restrictions(TSMC);

  expect(lists.getRestrictions).toHaveBeenCalledTimes(2);
});

test("a market no source lists has no restrictions", async () => {
  const { lists, fundamentals } = setup();

  expect(
    await fundamentals.restrictions({ market: Market.US, symbol: "AAPL" })
  ).toEqual([]);
  expect(lists.getRestrictions).not.toHaveBeenCalled();
});

test("a fund is what its market's exchanges list it as, read for every fund at once and twice a day at most, and a stock is none", async () => {
  const { clock, lists, fundamentals } = setup();

  expect(await fundamentals.fund(TAIWAN_50)).toEqual(INDEX_FUND);
  expect(await fundamentals.fund(TSMC)).toBeNull();
  expect(lists.getFunds).toHaveBeenCalledExactlyOnceWith(Market.TW);

  clock.now += 13 * HOUR_MS;
  await fundamentals.fund(TAIWAN_50);

  expect(lists.getFunds).toHaveBeenCalledTimes(2);
});

test("a market no source lists the funds of has none", async () => {
  const { lists, fundamentals } = setup();

  expect(
    await fundamentals.fund({ market: Market.US, symbol: "SPY" })
  ).toBeNull();
  expect(lists.getFunds).not.toHaveBeenCalled();
});

test("a fund's net asset value is its own among its market's, read for every fund at once and once an hour at most, and a stock has none", async () => {
  const { clock, reports, fundamentals } = setup();

  expect(await fundamentals.netAssetValue(TAIWAN_50)).toEqual(NET_ASSET_VALUE);
  expect(await fundamentals.netAssetValue(TSMC)).toBeNull();
  expect(reports.getNetAssetValues).toHaveBeenCalledExactlyOnceWith(Market.TW);

  clock.now += HOUR_MS;
  await fundamentals.netAssetValue(TAIWAN_50);

  expect(reports.getNetAssetValues).toHaveBeenCalledTimes(2);
});

test("a fund's costs are its own among its market's, read for every fund at once and twice a day at most, and a stock has none", async () => {
  const { clock, reports, fundamentals } = setup();

  expect(await fundamentals.fundCosts(TAIWAN_50)).toEqual(FUND_COSTS);
  expect(await fundamentals.fundCosts(TSMC)).toBeNull();
  expect(reports.getCosts).toHaveBeenCalledExactlyOnceWith(Market.TW);

  clock.now += HOUR_MS;
  await fundamentals.fundCosts(TAIWAN_50);

  expect(reports.getCosts).toHaveBeenCalledOnce();

  clock.now += 12 * HOUR_MS;
  await fundamentals.fundCosts(TAIWAN_50);

  expect(reports.getCosts).toHaveBeenCalledTimes(2);
});

test("a market no source of what funds report covers has no net asset values or costs", async () => {
  const { reports, fundamentals } = setup();
  const spy = { market: Market.US, symbol: "SPY" };

  expect(await fundamentals.netAssetValue(spy)).toBeNull();
  expect(await fundamentals.fundCosts(spy)).toBeNull();
  expect(reports.getNetAssetValues).not.toHaveBeenCalled();
  expect(reports.getCosts).not.toHaveBeenCalled();
});

test("a listing's multiples are its own among those its market's exchanges work out, read once an hour at most, and a fund has none", async () => {
  const { clock, lists, fundamentals } = setup();

  expect(await fundamentals.multiples(TSMC)).toEqual(MULTIPLES);
  expect(await fundamentals.multiples(TAIWAN_50)).toBeNull();
  expect(lists.getMultiples).toHaveBeenCalledExactlyOnceWith(Market.TW);

  clock.now += HOUR_MS;
  await fundamentals.multiples(TSMC);

  expect(lists.getMultiples).toHaveBeenCalledTimes(2);
});

test("a listing's price limits are its own among those its market's exchanges set, read once an hour at most", async () => {
  const { clock, lists, fundamentals } = setup();

  expect(await fundamentals.priceLimits(TSMC)).toEqual(PRICE_LIMITS);
  expect(await fundamentals.priceLimits(TAIWAN_50)).toBeNull();
  expect(lists.getPriceLimits).toHaveBeenCalledExactlyOnceWith(Market.TW);

  clock.now += HOUR_MS;
  await fundamentals.priceLimits(TSMC);

  expect(lists.getPriceLimits).toHaveBeenCalledTimes(2);
});

test("a listing's notices of going ex and its shareholders' meetings are its own among its market's, notices read once an hour and meetings twice a day at most", async () => {
  const { clock, lists, fundamentals } = setup();

  expect(await fundamentals.exNotices(TAIWAN_50)).toEqual([EX_NOTICE]);
  expect(await fundamentals.exNotices(TSMC)).toEqual([]);
  expect(await fundamentals.meetings(TSMC)).toEqual([MEETING]);
  expect(await fundamentals.meetings(TAIWAN_50)).toEqual([]);
  expect(lists.getExNotices).toHaveBeenCalledExactlyOnceWith(Market.TW);
  expect(lists.getMeetings).toHaveBeenCalledExactlyOnceWith(Market.TW);

  clock.now += HOUR_MS;
  await fundamentals.exNotices(TSMC);
  await fundamentals.meetings(TSMC);

  expect(lists.getExNotices).toHaveBeenCalledTimes(2);
  expect(lists.getMeetings).toHaveBeenCalledTimes(1);

  clock.now += 12 * HOUR_MS;
  await fundamentals.meetings(TSMC);

  expect(lists.getMeetings).toHaveBeenCalledTimes(2);
});

test("a listing's multiples stand among those of the others its exchanges class in its industry", async () => {
  const { lists, fundamentals } = setup();

  expect(await fundamentals.peers(TSMC)).toEqual({
    industry: CHIPS,
    // Four are classed there; three others, of which two have multiples worked out.
    listings: 4,
    asOf: MULTIPLES.asOf,
    priceToEarnings: { value: 29.56, peers: 1, median: 12, above: 1 },
    dividendYield: { value: 0.86, peers: 2, median: 0.86, above: 0 },
    priceToBook: { value: 10.28, peers: 2, median: 2.75, above: 1 },
  });
  expect(lists.getIndustries).toHaveBeenCalledExactlyOnceWith(Market.TW);

  // A fund is classed in no industry, and a market no source lists has none.
  expect(await fundamentals.peers(TAIWAN_50)).toBeNull();
  expect(
    await fundamentals.peers({ market: Market.US, symbol: "NVDA" })
  ).toBeNull();
});
