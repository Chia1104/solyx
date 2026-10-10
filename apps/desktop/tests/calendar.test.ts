import { expect, test, vi } from "vite-plus/test";

import { EventTiming, ListingEventKind } from "@solyx/core/calendar";
import { RestrictionKind } from "@solyx/core/fundamentals";
import type { Dividend, Fundamentals } from "@solyx/core/fundamentals";
import { MacroIndicator } from "@solyx/core/macro";
import type { MacroCalendarProvider, MacroRelease } from "@solyx/core/macro";
import { Market, symbolKey } from "@solyx/core/market";
import type { SymbolRef } from "@solyx/core/market";
import type { Report } from "@solyx/core/report";
import { memoryAnswers } from "@solyx/utils/fresh";

import { createCalendar } from "../src/main/modules/calendar/calendar.ts";

const TSMC = { market: Market.TW, symbol: "2330" };

const FOXCONN = { market: Market.TW, symbol: "2317" };

const MEDIATEK = { market: Market.TW, symbol: "2454" };

function cash(amount: number, cashExDate: string): Dividend {
  return {
    period: "115年第2季",
    announced: "2026-09-25",
    cash: amount,
    stock: 0,
    cashExDate,
    cashPaidOn: null,
    stockExDate: null,
  };
}

const AAPL = { market: Market.US, symbol: "AAPL" };

const HOUR_MS = 60 * 60 * 1000;

function consumerPrices(date: string, period: string): MacroRelease {
  return {
    market: Market.TW,
    indicator: MacroIndicator.ConsumerPrices,
    date,
    timing: EventTiming.Set,
    period,
  };
}

function setup(dividends: Record<string, Dividend[]>) {
  const fundamentals = {
    statements: async () => [],
    monthlyRevenue: async () => [],
    restrictions: vi.fn<Fundamentals["restrictions"]>(async () => []),
    dividends: vi.fn(async (symbol: SymbolRef) => {
      const listed = dividends[symbolKey(symbol)];

      if (!listed) throw new Error("FinMind answered 402");

      return listed;
    }),
  };

  const macro = {
    id: "fake",
    markets: [Market.TW],
    releases: vi.fn<MacroCalendarProvider["releases"]>(async () => [
      consumerPrices("2026-10-07", "2026-09"),
      consumerPrices("2026-11-05", "2026-10"),
      consumerPrices("2026-12-08", "2026-11"),
    ]),
  };

  // 2026-10-08 12:00 in Taipei.
  const clock = { now: Date.parse("2026-10-08T04:00:00Z") };
  const held = new Map<string, Pick<Report, "symbol" | "events">>();

  const calendar = createCalendar({
    fundamentals,
    macro: [macro],
    reports: { report: (symbol) => held.get(symbolKey(symbol)) },
    answers: memoryAnswers(),
    now: () => new Date(clock.now),
  });

  return { calendar, fundamentals, macro, clock, held };
}

test("every listing's events come soonest first, within the days asked for", async () => {
  const { calendar } = setup({
    [symbolKey(TSMC)]: [cash(7, "2026-10-20"), cash(7.5, "2026-12-10")],
    [symbolKey(FOXCONN)]: [cash(5.2, "2026-10-15")],
  });

  const { events, unread } = await calendar.upcoming([TSMC, FOXCONN], 30);

  expect(
    events.map(({ symbol, kind, date }) => [symbol.symbol, kind, date])
  ).toEqual([
    ["2317", ListingEventKind.ExDividend, "2026-10-15"],
    ["2330", ListingEventKind.ExDividend, "2026-10-20"],
  ]);
  expect(unread).toEqual([]);
});

test("a restriction in force shows today, with its last day", async () => {
  const { calendar, fundamentals } = setup({ [symbolKey(TSMC)]: [] });

  fundamentals.restrictions.mockResolvedValue([
    {
      kind: RestrictionKind.ShortSaleSuspension,
      from: "2026-10-05",
      until: "2026-10-12",
      note: "除息",
    },
  ]);

  const { events } = await calendar.upcoming([TSMC], 30);

  expect(events).toEqual([
    {
      symbol: TSMC,
      kind: ListingEventKind.ShortSaleSuspension,
      date: "2026-10-08",
      timing: EventTiming.Set,
      subject: "除息",
      amount: null,
      until: "2026-10-12",
    },
  ]);
});

test("the dates the listings' reports hold come soonest first, without those behind today or past the days asked for", async () => {
  const { calendar, held } = setup({
    [symbolKey(TSMC)]: [],
    [symbolKey(FOXCONN)]: [],
  });

  const event = (date: string, label: string) => ({
    date,
    label,
    timing: EventTiming.Set,
    source: "Investor relations calendar",
    quote: label,
    support: null,
  });

  held.set(symbolKey(TSMC), {
    symbol: TSMC,
    events: [
      event("2026-10-16", "Earnings call"),
      event("2026-10-07", "Technology forum"),
      event("2026-12-01", "Shareholders' meeting"),
    ],
  });
  held.set(symbolKey(FOXCONN), {
    symbol: FOXCONN,
    events: [event("2026-10-13", "Technology day")],
  });

  const { research } = await calendar.upcoming([TSMC, FOXCONN, MEDIATEK], 30);

  expect(
    research.map(({ symbol, date, label }) => [symbol, date, label])
  ).toEqual([
    [FOXCONN, "2026-10-13", "Technology day"],
    [TSMC, "2026-10-16", "Earnings call"],
  ]);
});

test("a listing that cannot be read is named, and the others' events stay", async () => {
  const { calendar } = setup({
    [symbolKey(TSMC)]: [cash(7, "2026-10-20")],
  });

  const { events, unread } = await calendar.upcoming([TSMC, MEDIATEK], 30);

  expect(events.map(({ symbol }) => symbol)).toEqual([TSMC]);
  expect(unread).toEqual([MEDIATEK]);
});

test("the listings' markets' releases come within the days asked for, each market's schedule read twice a day at most", async () => {
  const { calendar, macro, clock } = setup({
    [symbolKey(TSMC)]: [],
    [symbolKey(FOXCONN)]: [],
    [symbolKey(AAPL)]: [],
  });

  const { releases, unreadMarkets } = await calendar.upcoming(
    [TSMC, FOXCONN, AAPL],
    30
  );

  expect(releases).toEqual([consumerPrices("2026-11-05", "2026-10")]);
  expect(unreadMarkets).toEqual([]);
  expect(macro.releases).toHaveBeenCalledExactlyOnceWith(
    Market.TW,
    "2026-10-08"
  );

  clock.now += 11 * HOUR_MS;
  await calendar.upcoming([TSMC], 30);

  expect(macro.releases).toHaveBeenCalledTimes(1);

  clock.now += 2 * HOUR_MS;
  await calendar.upcoming([TSMC], 30);

  expect(macro.releases).toHaveBeenCalledTimes(2);
});

test("a schedule that cannot be read names its market, read again on the next ask, and the listings' events stay", async () => {
  const { calendar, macro } = setup({
    [symbolKey(TSMC)]: [cash(7, "2026-10-20")],
  });

  macro.releases.mockRejectedValueOnce(new Error("stat.gov.tw answered 503"));

  const failed = await calendar.upcoming([TSMC], 30);

  expect(failed.events.map(({ symbol }) => symbol)).toEqual([TSMC]);
  expect(failed.releases).toEqual([]);
  expect(failed.unreadMarkets).toEqual([Market.TW]);

  const again = await calendar.upcoming([TSMC], 30);

  expect(again.unreadMarkets).toEqual([]);
  expect(macro.releases).toHaveBeenCalledTimes(2);
});
