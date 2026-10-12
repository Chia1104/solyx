import { expect, test, vi } from "vite-plus/test";

import { RestrictionKind } from "@solyx/core/fundamentals";
import type {
  FundamentalsProvider,
  FundsProvider,
  RestrictionsProvider,
} from "@solyx/core/fundamentals";
import { Market } from "@solyx/core/market";
import { memoryAnswers } from "@solyx/utils/fresh";

import { createFundamentals } from "../src/main/modules/fundamentals/fundamentals.ts";

const TSMC = { market: Market.TW, symbol: "2330" };

const TAIWAN_50 = { market: Market.TW, symbol: "0050" };

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

const DISPOSITION = {
  kind: RestrictionKind.Disposition,
  from: "2026-10-08",
  until: "2026-10-15",
  note: "第一次處置：連續三次",
};

const HOUR_MS = 60 * 60 * 1000;

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
    getRestrictions: vi.fn<RestrictionsProvider["getRestrictions"]>(
      async () => [
        { symbol: "2330", ...SHORT_SALE },
        { symbol: "0050", ...SHORT_SALE },
        { symbol: "2330", ...DISPOSITION },
      ]
    ),
    getFunds: vi.fn<FundsProvider["getFunds"]>(async () => [
      { symbol: "0050", ...INDEX_FUND },
    ]),
  };

  const fundamentals = createFundamentals({
    providers: [provider],
    restrictions: [lists],
    funds: [lists],
    answers,
    now: () => new Date(clock.now),
  });

  return { clock, provider, lists, fundamentals };
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
