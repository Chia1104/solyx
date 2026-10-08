import { sortBy } from "es-toolkit";

import { RestrictionKind } from "./fundamentals.ts";
import type {
  Dividend,
  MonthlyRevenue,
  QuarterStatement,
  TradingRestriction,
} from "./fundamentals.ts";
import type { MacroRelease } from "./macro.ts";
import { Market } from "./market.ts";
import type { SymbolRef } from "./market.ts";
import { twFilingDeadline, twRevenueDeadline } from "./rules/tw.ts";

/** What happens on a listing's calendar. */
export const ListingEventKind = {
  /** A quarter's statements are filed. */
  QuarterlyReport: "quarterly-report",
  /** A month's revenue is reported. */
  MonthlyRevenue: "monthly-revenue",
  /** The first session the shares trade without a cash dividend. */
  ExDividend: "ex-dividend",
  /** The first session the shares trade without a stock dividend. */
  ExRights: "ex-rights",
  /** A cash dividend is paid. */
  DividendPayment: "dividend-payment",
  ...RestrictionKind,
} as const;

export type ListingEventKind =
  (typeof ListingEventKind)[keyof typeof ListingEventKind];

/** How surely an event falls on its day. */
export const EventTiming = {
  /** Whoever releases it set the day. */
  Set: "set",
  /** The latest day the rules or the agency allow; it may well come earlier. */
  Deadline: "deadline",
} as const;

export type EventTiming = (typeof EventTiming)[keyof typeof EventTiming];

export interface ListingEvent {
  symbol: SymbolRef;
  kind: ListingEventKind;
  /** `YYYY-MM-DD` on the exchange's calendar; today for a restriction already in force. */
  date: string;
  timing: EventTiming;
  /** What it is about: a quarter's last day, a month (`YYYY-MM`), a distribution's period or a restriction's note. */
  subject: string;
  /** A distribution's cash or stock per share, in the market's currency; `null` for a filing or a restriction. */
  amount: number | null;
  /** A restriction's last day; `null` for an event of one day or a restriction with no end set. */
  until: string | null;
}

/** Some listings' coming events and their markets' releases, as a host's calendar serves them. */
export interface UpcomingEvents {
  /** Soonest first. */
  events: ListingEvent[];
  /** Listings whose fundamentals could not be read this time, so their events may be missing. */
  unread: SymbolRef[];
  /** The economic releases of the listings' markets, soonest first. */
  releases: MacroRelease[];
  /** Markets whose release schedule could not be read this time, so their releases may be missing. */
  unreadMarkets: Market[];
}

/** What a listing's events are derived from, as `Fundamentals` serves it. */
export interface ListingFilings {
  statements: readonly QuarterStatement[];
  monthlyRevenue: readonly MonthlyRevenue[];
  dividends: readonly Dividend[];
  restrictions: readonly TradingRestriction[];
}

function quarterEnd(periodEnd: string, quarters: number): string {
  const month = Temporal.PlainDate.from(periodEnd)
    .toPlainYearMonth()
    .add({ months: 3 * quarters });

  return month.toPlainDate({ day: month.daysInMonth }).toString();
}

const nextMonth = (month: string, months: number) =>
  Temporal.PlainYearMonth.from(month).add({ months }).toString();

/**
 * The periods after the newest one out, each with the day it is due by, until one is due after
 * `until`; none before the first period is out, since a listing that files none, such as an ETF,
 * has none due.
 */
function duePeriods(
  newest: string | undefined,
  next: (period: string, steps: number) => string,
  deadline: (period: string) => string,
  until: string
): { period: string; due: string }[] {
  if (newest === undefined) return [];

  const due: { period: string; due: string }[] = [];

  for (let steps = 1; ; steps++) {
    const period = next(newest, steps);
    const day = deadline(period);

    if (day > until) return due;

    due.push({ period, due: day });
  }
}

/**
 * A listing's events from `today` through `until` (`YYYY-MM-DD` on the exchange's calendar),
 * soonest first: each quarter's statements and month's revenue not out yet, by the day they are
 * due, the days its distributions go ex and are paid, and its restrictions, those in force today
 * among them. Only Taiwan's rules set filing deadlines, so elsewhere a listing has no filings.
 */
export function upcomingEvents(
  symbol: SymbolRef,
  { statements, monthlyRevenue, dividends, restrictions }: ListingFilings,
  today: string,
  until: string
): ListingEvent[] {
  const filings: ListingEvent[] =
    symbol.market === Market.TW
      ? [
          ...duePeriods(
            statements.at(-1)?.periodEnd,
            quarterEnd,
            twFilingDeadline,
            until
          ).map(({ period, due }) => ({
            symbol,
            kind: ListingEventKind.QuarterlyReport,
            date: due,
            timing: EventTiming.Deadline,
            subject: period,
            amount: null,
            until: null,
          })),
          ...duePeriods(
            monthlyRevenue.at(-1)?.month,
            nextMonth,
            twRevenueDeadline,
            until
          ).map(({ period, due }) => ({
            symbol,
            kind: ListingEventKind.MonthlyRevenue,
            date: due,
            timing: EventTiming.Deadline,
            subject: period,
            amount: null,
            until: null,
          })),
        ]
      : [];

  const distributions = dividends.flatMap((dividend) =>
    [
      {
        kind: ListingEventKind.ExDividend,
        date: dividend.cashExDate,
        amount: dividend.cash,
      },
      {
        kind: ListingEventKind.DividendPayment,
        date: dividend.cashPaidOn,
        amount: dividend.cash,
      },
      {
        kind: ListingEventKind.ExRights,
        date: dividend.stockExDate,
        amount: dividend.stock,
      },
    ].flatMap(({ kind, date, amount }) =>
      date === null || amount === 0
        ? []
        : [
            {
              symbol,
              kind,
              date,
              timing: EventTiming.Set,
              subject: dividend.period,
              amount,
              until: null,
            },
          ]
    )
  );

  const limits = restrictions.flatMap((restriction): ListingEvent[] =>
    restriction.until !== null && restriction.until < today
      ? []
      : [
          {
            symbol,
            kind: restriction.kind,
            date: restriction.from < today ? today : restriction.from,
            timing: EventTiming.Set,
            subject: restriction.note ?? "",
            amount: null,
            until: restriction.until,
          },
        ]
  );

  return sortBy(
    [...filings, ...distributions, ...limits].filter(
      ({ date }) => date >= today && date <= until
    ),
    [({ date }) => date]
  );
}
