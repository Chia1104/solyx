import { sortBy, uniq } from "es-toolkit";

import {
  RELEASED_DAYS,
  reportedEvents,
  upcomingEvents,
} from "@solyx/core/calendar";
import type { UpcomingEvents } from "@solyx/core/calendar";
import type { Fundamentals } from "@solyx/core/fundamentals";
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

  function closuresOf(market: Market): Promise<MarketClosure[]> {
    const provider = closures.find(({ markets }) => markets.includes(market));

    return provider ? closed({ market, provider }) : Promise.resolve([]);
  }

  /** What was read of each market's, soonest first, within the days asked for. */
  const ahead = <Dated extends { market: Market; date: string }>(
    read: PromiseSettledResult<Dated[]>[],
    within: (market: Market, date: string) => boolean
  ) =>
    sortBy(
      read.flatMap((each) =>
        each.status === "fulfilled"
          ? each.value.filter(({ market, date }) => within(market, date))
          : []
      ),
      [({ date }) => date]
    );

  return {
    /**
     * One listing or market failing to read leaves the others', and names it among the unread. A
     * listing's filings and what its exchange lists of it come from different sources, so one of
     * them failing leaves the events of what was read.
     */
    async upcoming(
      symbols: readonly SymbolRef[],
      days: number
    ): Promise<UpcomingEvents> {
      const at = now();
      const markets = uniq(symbols.map(({ market }) => market));

      /** Whether a day falls from `back` days before a market's today through the days asked for. */
      const within = (back: number) => (market: Market, date: string) => {
        const today = exchangeDate(market, at);

        return (
          date >= shiftDate(today, -back) && date <= shiftDate(today, days)
        );
      };

      const [read, scheduled, closing] = await Promise.all([
        Promise.all(
          symbols.map(async (symbol) => {
            const [
              statements,
              monthlyRevenue,
              dividends,
              restrictions,
              notices,
              meetings,
            ] = await Promise.allSettled([
              fundamentals.statements(symbol),
              fundamentals.monthlyRevenue(symbol),
              fundamentals.dividends(symbol),
              fundamentals.restrictions(symbol),
              fundamentals.exNotices(symbol),
              fundamentals.meetings(symbol),
            ]);

            const today = exchangeDate(symbol.market, at);

            return {
              whole: [
                statements,
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
          })
        ),
        Promise.allSettled(markets.map((market) => macro.schedule(market))),
        Promise.allSettled(markets.map(closuresOf)),
      ]);

      return {
        events: sortBy(
          read.flatMap(({ events }) => events),
          [({ date }) => date]
        ),
        research: sortBy(
          symbols.flatMap((symbol) => {
            const report = reports.report(symbol);
            const today = exchangeDate(symbol.market, at);

            return report
              ? reportedEvents(report, today, shiftDate(today, days))
              : [];
          }),
          [({ date }) => date]
        ),
        unread: symbols.filter((_, index) => !read[index].whole),
        releases: ahead(scheduled, within(RELEASED_DAYS)),
        closures: ahead(closing, within(0)),
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
