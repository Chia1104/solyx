import { sortBy } from "es-toolkit";

import { shiftMonth } from "@solyx/utils/date";

import { RestrictionKind } from "./fundamentals.ts";
import type {
  Dividend,
  ExNotice,
  MonthlyRevenue,
  QuarterStatement,
  ShareholdersMeeting,
  TradingRestriction,
} from "./fundamentals.ts";
import type { ExpectedFigure, MacroReading, MacroRelease } from "./macro.ts";
import { Market } from "./market.ts";
import type { SymbolRef } from "./market.ts";
import type { Report, ReportEvent } from "./report.ts";
import { twFilingDeadline, twRevenueDeadline } from "./rules/tw.ts";
import type { MarketClosure } from "./session.ts";

/** What happens on a listing's calendar. */
export const ListingEventKind = {
  /** A quarter's statements are filed. */
  QuarterlyReport: "quarterly-report",
  /** A month's revenue is reported. */
  MonthlyRevenue: "monthly-revenue",
  /** The first session the shares trade without a cash dividend. */
  ExDividend: "ex-dividend",
  /** The first session the shares trade without a stock dividend, or without the right to subscribe to new shares. */
  ExRights: "ex-rights",
  /** A cash dividend is paid. */
  DividendPayment: "dividend-payment",
  /** The year's regular shareholders' meeting is held. */
  RegularMeeting: "regular-meeting",
  /** A shareholders' meeting called apart from the year's regular one is held. */
  SpecialMeeting: "special-meeting",
  /** A shareholders' meeting elects directors. */
  DirectorElection: "director-election",
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
  /** A day a source expects, which nobody has set. */
  Expected: "expected",
} as const;

export type EventTiming = (typeof EventTiming)[keyof typeof EventTiming];

export interface ListingEvent {
  symbol: SymbolRef;
  kind: ListingEventKind;
  /** `YYYY-MM-DD` on the exchange's calendar; today for a restriction already in force. */
  date: string;
  timing: EventTiming;
  /**
   * What it is about: a quarter's last day, or the last of its last month where its results are
   * only expected, a month (`YYYY-MM`), a distribution's period or a
   * restriction's note; empty for a meeting, and for shares going ex that only the exchange's
   * notice tells of.
   */
  subject: string;
  /**
   * A distribution's cash or stock per share, in the market's currency; `null` for a filing, a
   * meeting or a restriction, and for shares going ex an amount the exchange's notice does not carry.
   */
  amount: number | null;
  /** A restriction's last day; `null` for an event of one day or a restriction with no end set. */
  until: string | null;
}

/** How many days a release stays on the calendar once its day has come, so the figures it brought are read there. */
export const RELEASED_DAYS = 7;

/** A release on the calendar with what is known of its figures, which `releaseReadings` finds in its market's series. */
export interface ReleaseEvent extends MacroRelease {
  /**
   * Its indicator's figures, the headline one first: at its own period once that is out, or else
   * at the newest period out before it. None for an indicator no source has figures of.
   */
  readings: MacroReading[];
  /** What the market expects of its figures while its own period is not out, which `releaseExpectations` finds. */
  expected: ExpectedFigure[];
}

/** A date a listing's report holds: what the agent found with its source, never a filing of the exchange or the company. */
export interface ResearchEvent extends ReportEvent {
  symbol: SymbolRef;
}

/**
 * Some listings' coming events and their markets' releases, as a host's calendar serves them. The
 * releases come without figures, which a market's series are read for apart, so a database slow to
 * answer never holds up the dates.
 */
export interface UpcomingEvents {
  /** Soonest first. */
  events: ListingEvent[];
  /** The dates the listings' reports hold, soonest first. */
  research: ResearchEvent[];
  /** Listings whose fundamentals could not be read this time, so their events may be missing. */
  unread: SymbolRef[];
  /** The economic releases of the listings' markets, soonest first, those of the last `RELEASED_DAYS` days among them. */
  releases: MacroRelease[];
  /** The weekdays the listings' markets are closed, soonest first. */
  closures: MarketClosure[];
  /** Markets whose releases or closures could not be read this time, so some of theirs may be missing. */
  unreadMarkets: Market[];
}

/** What a listing's events are derived from, as `Fundamentals` serves it. */
export interface ListingFilings {
  statements: readonly QuarterStatement[];
  /** The days its source expects its coming results out, where the market's rules set no deadline. */
  reportDates: readonly string[];
  monthlyRevenue: readonly MonthlyRevenue[];
  dividends: readonly Dividend[];
  restrictions: readonly TradingRestriction[];
  notices: readonly ExNotice[];
  meetings: readonly ShareholdersMeeting[];
}

function quarterEnd(periodEnd: string, quarters: number): string {
  const month = Temporal.PlainDate.from(periodEnd)
    .toPlainYearMonth()
    .add({ months: 3 * quarters });

  return month.toPlainDate({ day: month.daysInMonth }).toString();
}

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
 * Each day from `today` on that a listing's results are expected out, with the quarter they
 * report: the newest to end before that day, counted on from the newest one out, so a release
 * whose statements are not in yet still names its own quarter. None before the first quarter is
 * out, since a listing that files none, such as an ETF, reports none.
 */
function expectedReports(
  newest: string | undefined,
  dates: readonly string[],
  today: string
): { period: string; date: string }[] {
  if (newest === undefined) return [];

  return [...new Set(dates)]
    .filter((date) => date >= today)
    .toSorted()
    .map((date) => {
      let period = newest;

      for (let steps = 1; quarterEnd(newest, steps) < date; steps++) {
        period = quarterEnd(newest, steps);
      }

      return { period, date };
    });
}

/**
 * A listing's events from `today` through `until` (`YYYY-MM-DD` on the exchange's calendar),
 * soonest first: each quarter's statements and month's revenue not out yet, by the day they are
 * due, the days its distributions go ex and are paid, the days its exchange gives notice its shares
 * go ex where no distribution tells of them, its shareholders' meetings, and its restrictions,
 * those in force today among them. Only Taiwan's rules set filing deadlines, so elsewhere a
 * quarter's statements come on the day its source expects its results, at the end of a month
 * near enough to name the quarter.
 */
export function upcomingEvents(
  symbol: SymbolRef,
  {
    statements,
    reportDates,
    monthlyRevenue,
    dividends,
    restrictions,
    notices,
    meetings,
  }: ListingFilings,
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
            shiftMonth,
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
      : expectedReports(statements.at(-1)?.periodEnd, reportDates, today).map(
          ({ period, date }) => ({
            symbol,
            kind: ListingEventKind.QuarterlyReport,
            date,
            timing: EventTiming.Expected,
            subject: period,
            amount: null,
            until: null,
          })
        );

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

  // A distribution names its period and amount, so the exchange's notice of the same day adds nothing to it.
  const noticed = notices
    .flatMap(({ date, exDividend, exRights, cash }) => [
      ...(exDividend
        ? [{ kind: ListingEventKind.ExDividend, date, amount: cash }]
        : []),
      ...(exRights
        ? [{ kind: ListingEventKind.ExRights, date, amount: null }]
        : []),
    ])
    .filter(
      (notice) =>
        !distributions.some(
          ({ kind, date }) => kind === notice.kind && date === notice.date
        )
    )
    .map(({ kind, date, amount }) => ({
      symbol,
      kind,
      date,
      timing: EventTiming.Set,
      subject: "",
      amount,
      until: null,
    }));

  const held = meetings.flatMap(({ date, regular, election }) =>
    [
      regular
        ? ListingEventKind.RegularMeeting
        : ListingEventKind.SpecialMeeting,
      ...(election ? [ListingEventKind.DirectorElection] : []),
    ].map((kind) => ({
      symbol,
      kind,
      date,
      timing: EventTiming.Set,
      subject: "",
      amount: null,
      until: null,
    }))
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
    [...filings, ...distributions, ...noticed, ...held, ...limits].filter(
      ({ date }) => date >= today && date <= until
    ),
    [({ date }) => date]
  );
}

/**
 * The dates a report holds from `today` through `until` (`YYYY-MM-DD` on the exchange's calendar),
 * soonest first. One whose day is behind `today` is no longer ahead, so it is left out until the
 * report says what came of it.
 */
export function reportedEvents(
  { symbol, events }: Pick<Report, "symbol" | "events">,
  today: string,
  until: string
): ResearchEvent[] {
  return sortBy(
    events
      .filter(({ date }) => date >= today && date <= until)
      .map((event) => ({ ...event, symbol })),
    [({ date }) => date]
  );
}
