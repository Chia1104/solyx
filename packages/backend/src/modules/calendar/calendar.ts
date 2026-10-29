import { sortBy, uniq } from "es-toolkit";

import {
  RELEASED_DAYS,
  reportedEvents,
  upcomingEvents,
} from "@solyx/core/calendar";
import type {
  ListingEvents,
  ResearchEvent,
  UpcomingEvents,
} from "@solyx/core/calendar";
import type { Fundamentals } from "@solyx/core/fundamentals";
import type { MacroRelease } from "@solyx/core/macro";
import { exchangeDate } from "@solyx/core/market";
import type { Market, SymbolRef } from "@solyx/core/market";
import type { Report } from "@solyx/core/report";
import type { ClosuresProvider, MarketClosure } from "@solyx/core/session";
import { shiftDate, HOUR_MS } from "@solyx/utils/date";
import { freshFor, keepFresh } from "@solyx/utils/fresh";
import type { AnswerStores } from "@solyx/utils/fresh";

import type { Macro } from "../macro/macro.ts";

// An exchange sets its closures a year ahead, so a market's are read twice a day at most.
const CLOSURES_FRESH_MS = 12 * HOUR_MS;

export interface CalendarOptions {
  fundamentals: Pick<
    Fundamentals,
    | "statements"
    | "reportDates"
    | "monthlyRevenue"
    | "dividends"
    | "restrictions"
    | "exNotices"
    | "meetings"
  >;
  /** Each market's schedule of economic releases. */
  macro: Pick<Macro, "schedule">;
  /** The sources of the days exchanges close their markets, one per market at most. */
  closures: readonly ClosuresProvider[];
  /** Each listing's report in force, for the dates it holds. */
  reports: {
    report(symbol: SymbolRef): Pick<Report, "symbol" | "events"> | undefined;
  };
  /** Where each market's closures are kept between runs. */
  answers: AnswerStores;
  /** @default () => new Date() */
  now?: () => Date;
}

interface Ask<Provider> {
  market: Market;
  provider: Provider;
}

const readOrNone = <Answer>(read: PromiseSettledResult<Answer[]>) =>
  read.status === "fulfilled" ? read.value : [];

/**
 * Listings' events as their fundamentals tell them, read through the fundamentals module, which
 * keeps what it reads, beside the dates their reports hold and their markets' closures and
 * economic releases, each release kept for `RELEASED_DAYS` once its day has come.
 */
export function createCalendar({
  fundamentals,
  macro,
  closures,
  reports,
  answers,
  now = () => new Date(),
}: CalendarOptions) {
  const closed = keepFresh<Ask<ClosuresProvider>, MarketClosure[]>({
    store: answers("market-closures"),
    id: ({ market, provider }) => `${provider.id}:${market}`,
    ask: ({ market, provider }) => provider.getClosures(market),
    fresh: freshFor(CLOSURES_FRESH_MS),
    now: () => now().getTime(),
  });

  /** Whether a day falls from `back` days before a market's today through `days` after it. */
  const within = (market: Market, back: number, days: number) => {
    const today = exchangeDate(market, now());

    return ({ date }: { date: string }) =>
      date >= shiftDate(today, -back) && date <= shiftDate(today, days);
  };

  /**
   * A listing's filings and what its exchange lists of it come from different sources, so one of
   * them failing leaves the events of what was read.
   */
  async function listing(
    symbol: SymbolRef,
    days: number
  ): Promise<ListingEvents> {
    const [
      statements,
      reportDates,
      monthlyRevenue,
      dividends,
      restrictions,
      notices,
      meetings,
    ] = await Promise.allSettled([
      fundamentals.statements(symbol),
      fundamentals.reportDates(symbol),
      fundamentals.monthlyRevenue(symbol),
      fundamentals.dividends(symbol),
      fundamentals.restrictions(symbol),
      fundamentals.exNotices(symbol),
      fundamentals.meetings(symbol),
    ]);

    const today = exchangeDate(symbol.market, now());

    return {
      whole: [
        statements,
        reportDates,
        monthlyRevenue,
        dividends,
        restrictions,
        notices,
        meetings,
      ].every(({ status }) => status === "fulfilled"),
      events: upcomingEvents(
        symbol,
        {
          statements: readOrNone(statements),
          reportDates: readOrNone(reportDates),
          monthlyRevenue: readOrNone(monthlyRevenue),
          dividends: readOrNone(dividends),
          restrictions: readOrNone(restrictions),
          notices: readOrNone(notices),
          meetings: readOrNone(meetings),
        },
        today,
        shiftDate(today, days)
      ),
    };
  }

  /** The dates the listings' reports in force hold, soonest first. */
  function research(
    symbols: readonly SymbolRef[],
    days: number
  ): ResearchEvent[] {
    return sortBy(
      symbols.flatMap((symbol) => {
        const report = reports.report(symbol);
        const today = exchangeDate(symbol.market, now());

        return report
          ? reportedEvents(report, today, shiftDate(today, days))
          : [];
      }),
      [({ date }) => date]
    );
  }

  /** A market's economic releases from `RELEASED_DAYS` back, soonest first. */
  async function releasesOf(
    market: Market,
    days: number
  ): Promise<MacroRelease[]> {
    return sortBy(
      (await macro.schedule(market)).filter(
        within(market, RELEASED_DAYS, days)
      ),
      [({ date }) => date]
    );
  }

  /** The weekdays a market is closed, soonest first; none for a market no source covers. */
  async function closuresOf(
    market: Market,
    days: number
  ): Promise<MarketClosure[]> {
    const provider = closures.find(({ markets }) => markets.includes(market));

    if (!provider) return [];

    return sortBy(
      (await closed({ market, provider })).filter(within(market, 0, days)),
      [({ date }) => date]
    );
  }

  /** What was read of each, soonest first. */
  const merged = <Dated extends { date: string }>(
    read: PromiseSettledResult<Dated[]>[]
  ) => sortBy(read.flatMap(readOrNone), [({ date }) => date]);

  return {
    listing,
    research,
    releases: releasesOf,
    closures: closuresOf,

    /**
     * Every part at once, as the agent reads them. One listing or market failing to read leaves
     * the others', and names it among the unread.
     */
    async upcoming(
      symbols: readonly SymbolRef[],
      days: number
    ): Promise<UpcomingEvents> {
      const markets = uniq(symbols.map(({ market }) => market));

      const [read, scheduled, closing] = await Promise.all([
        Promise.all(symbols.map((symbol) => listing(symbol, days))),
        Promise.allSettled(markets.map((market) => releasesOf(market, days))),
        Promise.allSettled(markets.map((market) => closuresOf(market, days))),
      ]);

      return {
        events: sortBy(
          read.flatMap(({ events }) => events),
          [({ date }) => date]
        ),
        research: research(symbols, days),
        unread: symbols.filter((_, index) => !read[index].whole),
        releases: merged(scheduled),
        closures: merged(closing),
        unreadMarkets: markets.filter((_, index) =>
          [scheduled[index], closing[index]].some(
            ({ status }) => status === "rejected"
          )
        ),
      };
    },
  };
}

export type Calendar = ReturnType<typeof createCalendar>;
