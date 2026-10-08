import { sortBy } from "es-toolkit";

import type {
  Dividend,
  MonthlyRevenue,
  QuarterStatement,
} from "./fundamentals.ts";
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
  /** `YYYY-MM-DD` on the exchange's calendar. */
  date: string;
  timing: EventTiming;
  /** What it is about: a quarter's last day, a month (`YYYY-MM`) or a distribution's period. */
  subject: string;
  /** A distribution's cash or stock per share, in the market's currency; `null` for a filing. */
  amount: number | null;
}

/** What a listing's events are derived from, as `Fundamentals` serves it. */
export interface ListingFilings {
  statements: readonly QuarterStatement[];
  monthlyRevenue: readonly MonthlyRevenue[];
  dividends: readonly Dividend[];
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
 * due, and the days its distributions go ex and are paid. Only Taiwan's rules set filing
 * deadlines, so elsewhere a listing has its distributions alone.
 */
export function upcomingEvents(
  symbol: SymbolRef,
  { statements, monthlyRevenue, dividends }: ListingFilings,
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
            },
          ]
    )
  );

  return sortBy(
    [...filings, ...distributions].filter(
      ({ date }) => date >= today && date <= until
    ),
    [({ date }) => date]
  );
}
