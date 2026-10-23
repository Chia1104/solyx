import { expect, test, vi } from "vite-plus/test";

import { EventTiming, ListingEventKind } from "@solyx/core/calendar";
import { RestrictionKind } from "@solyx/core/fundamentals";
import type { Dividend, Fundamentals } from "@solyx/core/fundamentals";
import { MacroIndicator } from "@solyx/core/macro";
import type { MacroRelease } from "@solyx/core/macro";
import { Market, symbolKey } from "@solyx/core/market";
import type { SymbolRef } from "@solyx/core/market";
import type { Report } from "@solyx/core/report";
import type { ClosuresProvider } from "@solyx/core/session";
import { HOUR_MS } from "@solyx/utils/date";
import { memoryAnswers } from "@solyx/utils/fresh";

import { createCalendar } from "../src/backend/modules/calendar/calendar.ts";
import type { Macro } from "../src/backend/modules/macro/macro.ts";

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

function consumerPrices(date: string, period: string): MacroRelease {
  return {
    market: Market.TW,
    indicator: MacroIndicator.ConsumerPrices,
    date,
    time: "16:00",
    timing: EventTiming.Set,
    period,
    page: null,
  };
}

function setup(dividends: Record<string, Dividend[]>) {
  const fundamentals = {
    statements: async () => [],
    monthlyRevenue: async () => [],
    restrictions: vi.fn<Fundamentals["restrictions"]>(async () => []),
    exNotices: vi.fn<Fundamentals["exNotices"]>(async () => []),
    meetings: vi.fn<Fundamentals["meetings"]>(async () => []),
    dividends: vi.fn(async (symbol: SymbolRef) => {
      const listed = dividends[symbolKey(symbol)];

      if (!listed) throw new Error("FinMind answered 402");

      return listed;
    }),
  };

  const macro = {
    schedule: vi.fn<Macro["schedule"]>(async (market) =>
      market === Market.TW
        ? [
            consumerPrices("2026-09-30", "2026-08"),
            consumerPrices("2026-10-07", "2026-09"),
            consumerPrices("2026-11-05", "2026-10"),
            consumerPrices("2026-12-08", "2026-11"),
          ]
        : []
    ),
  };

  const exchange = {
    id: "fake-exchange",
    markets: [Market.TW],
    getClosures: vi.fn<ClosuresProvider["getClosures"]>(async () => [
      { market: Market.TW, date: "2026-10-09", name: "國慶日" },
      { market: Market.TW, date: "2026-12-25", name: "行憲紀念日" },
    ]),
  };

  // 2026-10-08 12:00 in Taipei.
  const clock = { now: Date.parse("2026-10-08T04:00:00Z") };
  const held = new Map<string, Pick<Report, "symbol" | "events">>();

  const calendar = createCalendar({
    fundamentals,
    macro,
    closures: [exchange],
    reports: { report: (symbol) => held.get(symbolKey(symbol)) },
    answers: memoryAnswers(),
    now: () => new Date(clock.now),
  });

  return { calendar, fundamentals, macro, exchange, clock, held };
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

test("a listing whose restrictions cannot be read keeps the events of what was read, and is named", async () => {
  const { calendar, fundamentals } = setup({
    [symbolKey(TSMC)]: [cash(7, "2026-10-20")],
  });

  fundamentals.restrictions.mockRejectedValue(new Error("TWSE answered 503"));

  const { events, unread } = await calendar.upcoming([TSMC], 30);

  expect(events.map(({ kind, date }) => [kind, date])).toEqual([
    [ListingEventKind.ExDividend, "2026-10-20"],
  ]);
  expect(unread).toEqual([TSMC]);
});

test("what a listing's exchange lists of it joins its filings: the notices of its shares going ex and its shareholders' meetings", async () => {
  const { calendar, fundamentals } = setup({
    [symbolKey(TSMC)]: [cash(7, "2026-10-20")],
  });

  fundamentals.exNotices.mockResolvedValue([
    { date: "2026-10-20", exDividend: true, exRights: false, cash: 7 },
    { date: "2026-10-22", exDividend: false, exRights: true, cash: null },
  ]);
  fundamentals.meetings.mockResolvedValue([
    { date: "2026-10-13", regular: false, election: true },
  ]);

  const { events, unread } = await calendar.upcoming([TSMC], 30);

  expect(events.map(({ kind, date }) => [kind, date])).toEqual([
    [ListingEventKind.SpecialMeeting, "2026-10-13"],
    [ListingEventKind.DirectorElection, "2026-10-13"],
    [ListingEventKind.ExDividend, "2026-10-20"],
    [ListingEventKind.ExRights, "2026-10-22"],
  ]);
  expect(unread).toEqual([]);
});

test("the listings' markets' releases come from a week back through the days asked for", async () => {
  const { calendar, macro } = setup({
    [symbolKey(TSMC)]: [],
    [symbolKey(FOXCONN)]: [],
    [symbolKey(AAPL)]: [],
  });

  const { releases, unreadMarkets } = await calendar.upcoming(
    [TSMC, FOXCONN, AAPL],
    30
  );

  expect(releases.map(({ date, period }) => [date, period])).toEqual([
    // Out yesterday.
    ["2026-10-07", "2026-09"],
    ["2026-11-05", "2026-10"],
  ]);
  expect(unreadMarkets).toEqual([]);
  expect(macro.schedule.mock.calls).toEqual([[Market.TW], [Market.US]]);
});

test("the weekdays the listings' markets are closed come within the days asked for, read twice a day at most", async () => {
  const { calendar, exchange, clock } = setup({ [symbolKey(TSMC)]: [] });

  const { closures, unreadMarkets } = await calendar.upcoming([TSMC], 30);

  expect(closures).toEqual([
    { market: Market.TW, date: "2026-10-09", name: "國慶日" },
  ]);
  expect(unreadMarkets).toEqual([]);

  clock.now += 11 * HOUR_MS;
  await calendar.upcoming([TSMC], 30);

  expect(exchange.getClosures).toHaveBeenCalledExactlyOnceWith(Market.TW);
});

test("closures that cannot be read name their market, and its releases stay", async () => {
  const { calendar, exchange } = setup({ [symbolKey(TSMC)]: [] });

  exchange.getClosures.mockRejectedValue(new Error("TWSE answered 503"));

  const { closures, releases, unreadMarkets } = await calendar.upcoming(
    [TSMC],
    30
  );

  expect(closures).toEqual([]);
  expect(releases.map(({ date }) => date)).toEqual([
    "2026-10-07",
    "2026-11-05",
  ]);
  expect(unreadMarkets).toEqual([Market.TW]);
});

test("a schedule that cannot be read names its market, and the listings' events stay", async () => {
  const { calendar, macro } = setup({
    [symbolKey(TSMC)]: [cash(7, "2026-10-20")],
  });

  macro.schedule.mockRejectedValueOnce(new Error("stat.gov.tw answered 503"));

  const failed = await calendar.upcoming([TSMC], 30);

  expect(failed.events.map(({ symbol }) => symbol)).toEqual([TSMC]);
  expect(failed.releases).toEqual([]);
  expect(failed.unreadMarkets).toEqual([Market.TW]);

  const again = await calendar.upcoming([TSMC], 30);

  expect(again.unreadMarkets).toEqual([]);
});
