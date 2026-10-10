import { sortBy, uniq } from "es-toolkit";

import { reportedEvents, upcomingEvents } from "@solyx/core/calendar";
import type { UpcomingEvents } from "@solyx/core/calendar";
import type { Fundamentals } from "@solyx/core/fundamentals";
import type { MacroCalendarProvider, MacroRelease } from "@solyx/core/macro";
import { exchangeDate, shiftDate } from "@solyx/core/market";
import type { Market, SymbolRef } from "@solyx/core/market";
import type { Report } from "@solyx/core/report";
import { freshFor, keepFresh } from "@solyx/utils/fresh";
import type { AnswerStores } from "@solyx/utils/fresh";

// An agency sets its schedule months ahead, so a market's is read twice a day at most.
const SCHEDULE_FRESH_MS = 12 * 60 * 60 * 1000;

export interface CalendarOptions {
  fundamentals: Fundamentals;
  /** One per market at most; the first that covers a market answers for it. */
  macro: readonly MacroCalendarProvider[];
  /** Each listing's report in force, for the dates it holds. */
  reports: {
    report(symbol: SymbolRef): Pick<Report, "symbol" | "events"> | undefined;
  };
  /** Where each market's schedule is kept between runs. */
  answers: AnswerStores;
  /** @default () => new Date() */
  now?: () => Date;
}

interface Ask {
  market: Market;
  provider: MacroCalendarProvider;
}

/**
 * Listings' events as their fundamentals tell them, read through the fundamentals module, which
 * keeps each listing's answer for half a day, beside the dates their reports hold and the economic
 * releases of their markets.
 */
export function createCalendar({
  fundamentals,
  macro,
  reports,
  answers,
  now = () => new Date(),
}: CalendarOptions) {
  /** A market's releases from the day they were read on. */
  const schedules = keepFresh<Ask, MacroRelease[]>({
    store: answers("macro-releases"),
    id: ({ market, provider }) => `${provider.id}:${market}`,
    ask: ({ market, provider }) =>
      provider.releases(market, exchangeDate(market, now())),
    fresh: freshFor(SCHEDULE_FRESH_MS),
    now: () => now().getTime(),
  });

  function schedule(market: Market): Promise<MacroRelease[]> {
    const provider = macro.find(({ markets }) => markets.includes(market));

    return provider ? schedules({ market, provider }) : Promise.resolve([]);
  }

  return {
    /** One listing or market failing to read leaves the others', and names it among the unread. */
    async upcoming(
      symbols: readonly SymbolRef[],
      days: number
    ): Promise<UpcomingEvents> {
      const at = now();
      const markets = uniq(symbols.map(({ market }) => market));

      const within = (market: Market, date: string) => {
        const today = exchangeDate(market, at);

        return date >= today && date <= shiftDate(today, days);
      };

      const [read, scheduled] = await Promise.all([
        Promise.allSettled(
          symbols.map(async (symbol) => {
            const [statements, monthlyRevenue, dividends, restrictions] =
              await Promise.all([
                fundamentals.statements(symbol),
                fundamentals.monthlyRevenue(symbol),
                fundamentals.dividends(symbol),
                fundamentals.restrictions(symbol),
              ]);

            const today = exchangeDate(symbol.market, at);

            return upcomingEvents(
              symbol,
              { statements, monthlyRevenue, dividends, restrictions },
              today,
              shiftDate(today, days)
            );
          })
        ),
        Promise.allSettled(markets.map(schedule)),
      ]);

      return {
        events: sortBy(
          read.flatMap((each) =>
            each.status === "fulfilled" ? each.value : []
          ),
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
        unread: symbols.filter((_, index) => read[index].status === "rejected"),
        releases: sortBy(
          scheduled.flatMap((each) =>
            each.status === "fulfilled"
              ? each.value.filter(({ market, date }) => within(market, date))
              : []
          ),
          [({ date }) => date]
        ),
        unreadMarkets: markets.filter(
          (_, index) => scheduled[index].status === "rejected"
        ),
      };
    },
  };
}

export type Calendar = ReturnType<typeof createCalendar>;
