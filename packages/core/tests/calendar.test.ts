import { expect, test } from "vite-plus/test";

import {
  EventTiming,
  ListingEventKind,
  upcomingEvents,
} from "../src/calendar.ts";
import type { ListingFilings } from "../src/calendar.ts";
import { RestrictionKind } from "../src/fundamentals.ts";
import type { Dividend, QuarterStatement } from "../src/fundamentals.ts";
import { Market } from "../src/market.ts";
import { twFilingDeadline } from "../src/rules/tw.ts";

const TSMC = { market: Market.TW, symbol: "2330" };

function quarter(periodEnd: string): QuarterStatement {
  return {
    periodEnd,
    knownFrom: twFilingDeadline(periodEnd),
    revenue: 1,
    grossProfit: null,
    operatingIncome: null,
    netIncome: null,
    eps: null,
  };
}

function dividend(patch: Partial<Dividend>): Dividend {
  return {
    period: "115年第2季",
    announced: "2026-09-25",
    cash: 0,
    stock: 0,
    cashExDate: null,
    cashPaidOn: null,
    stockExDate: null,
    ...patch,
  };
}

const NONE: ListingFilings = {
  statements: [],
  monthlyRevenue: [],
  dividends: [],
  restrictions: [],
};

const brief = (filings: ListingFilings, today: string, until: string) =>
  upcomingEvents(TSMC, filings, today, until).map(
    ({ kind, date, timing, subject, amount }) => [
      date,
      kind,
      timing,
      subject,
      amount,
    ]
  );

test("the next quarter and month not out yet are due by their deadlines", () => {
  expect(
    brief(
      {
        ...NONE,
        statements: [quarter("2026-03-31"), quarter("2026-06-30")],
        monthlyRevenue: [{ month: "2026-08", revenue: 1 }],
      },
      "2026-10-08",
      "2026-11-30"
    )
  ).toEqual([
    // August's was out already; September's is due by the tenth.
    [
      "2026-10-10",
      ListingEventKind.MonthlyRevenue,
      EventTiming.Deadline,
      "2026-09",
      null,
    ],
    [
      "2026-11-10",
      ListingEventKind.MonthlyRevenue,
      EventTiming.Deadline,
      "2026-10",
      null,
    ],
    [
      "2026-11-14",
      ListingEventKind.QuarterlyReport,
      EventTiming.Deadline,
      "2026-09-30",
      null,
    ],
  ]);
});

test("a deadline already past is left out, and a listing that files nothing has none due", () => {
  // September's revenue was due by 2026-10-10 and is still not out.
  expect(
    brief(
      { ...NONE, monthlyRevenue: [{ month: "2026-08", revenue: 1 }] },
      "2026-10-12",
      "2026-11-05"
    )
  ).toEqual([]);

  expect(brief(NONE, "2026-10-08", "2027-10-08")).toEqual([]);
});

test("a distribution's ex and payment days fall on the days the company set, each with its amount", () => {
  expect(
    brief(
      {
        ...NONE,
        dividends: [
          dividend({
            period: "114年",
            cash: 0.4,
            stock: 0.8,
            cashExDate: "2026-10-20",
            stockExDate: "2026-10-20",
            cashPaidOn: "2026-11-23",
          }),
          // Gone ex before today, and paid after the window.
          dividend({
            cash: 7,
            cashExDate: "2026-09-16",
            cashPaidOn: "2026-12-08",
          }),
          // Decided, but its days are not set yet.
          dividend({ cash: 7.5 }),
        ],
      },
      "2026-10-08",
      "2026-11-30"
    )
  ).toEqual([
    ["2026-10-20", ListingEventKind.ExDividend, EventTiming.Set, "114年", 0.4],
    ["2026-10-20", ListingEventKind.ExRights, EventTiming.Set, "114年", 0.8],
    [
      "2026-11-23",
      ListingEventKind.DividendPayment,
      EventTiming.Set,
      "114年",
      0.4,
    ],
  ]);
});

test("a restriction comes on its first day, or today while it is in force, with its last day", () => {
  expect(
    upcomingEvents(
      TSMC,
      {
        ...NONE,
        restrictions: [
          {
            kind: RestrictionKind.ShortSaleSuspension,
            from: "2026-10-05",
            until: "2026-10-12",
            note: "除息",
          },
          {
            kind: RestrictionKind.Disposition,
            from: "2026-10-15",
            until: "2026-10-28",
            note: "第一次處置",
          },
          {
            kind: RestrictionKind.Halt,
            from: "2026-09-01",
            until: null,
            note: null,
          },
          // Over before today.
          {
            kind: RestrictionKind.DayTradingSuspension,
            from: "2026-09-10",
            until: "2026-09-15",
            note: "除息",
          },
        ],
      },
      "2026-10-08",
      "2026-11-07"
    ).map(({ date, kind, subject, until }) => [date, kind, subject, until])
  ).toEqual([
    ["2026-10-08", ListingEventKind.ShortSaleSuspension, "除息", "2026-10-12"],
    ["2026-10-08", ListingEventKind.Halt, "", null],
    ["2026-10-15", ListingEventKind.Disposition, "第一次處置", "2026-10-28"],
  ]);
});

test("outside Taiwan no rules set a filing deadline", () => {
  const apple = { market: Market.US, symbol: "AAPL" };

  expect(
    upcomingEvents(
      apple,
      {
        statements: [quarter("2026-06-30")],
        monthlyRevenue: [],
        dividends: [dividend({ cash: 0.26, cashExDate: "2026-11-09" })],
        restrictions: [],
      },
      "2026-10-08",
      "2026-11-30"
    ).map(({ kind }) => kind)
  ).toEqual([ListingEventKind.ExDividend]);
});
