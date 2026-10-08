import { sortBy, uniq } from "es-toolkit";

import { upcomingEvents } from "@solyx/core/calendar";
import type { Fundamentals } from "@solyx/core/fundamentals";
import type { MacroCalendarProvider, MacroRelease } from "@solyx/core/macro";
import { exchangeDate, shiftDate } from "@solyx/core/market";
import type { Market, SymbolRef } from "@solyx/core/market";

import type { UpcomingEvents } from "#shared/ipc/calendar.ts";

// An agency sets its schedule months ahead, so a market's is read twice a day at most.
const SCHEDULE_FRESH_MS = 12 * 60 * 60 * 1000;

export interface CalendarOptions {
  fundamentals: Fundamentals;
  /** One per market at most; the first that covers a market answers for it. */
  macro: readonly MacroCalendarProvider[];
  /** @default () => new Date() */
  now?: () => Date;
}

/**
 * Listings' events as their fundamentals tell them, read through the fundamentals module, which
 * keeps each listing's answer for half a day, beside the economic releases of their markets.
 */
export function createCalendar({
  fundamentals,
  macro,
  now = () => new Date(),
}: CalendarOptions) {
  const schedules = new Map<
    Market,
    { at: number; releases: Promise<MacroRelease[]> }
  >();

  /** A market's releases from the day it was read on, read again once stale or after a failure. */
  function schedule(market: Market): Promise<MacroRelease[]> {
    const provider = macro.find(({ markets }) => markets.includes(market));

    if (!provider) return Promise.resolve([]);

    const at = now().getTime();
    const held = schedules.get(market);

    if (held && at - held.at < SCHEDULE_FRESH_MS) return held.releases;

    const releases = provider.releases(market, exchangeDate(market, now()));

    schedules.set(market, { at, releases });

    releases.catch(() => {
      if (schedules.get(market)?.releases === releases) {
        schedules.delete(market);
      }
    });

    return releases;
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
            const [statements, monthlyRevenue, dividends] = await Promise.all([
              fundamentals.statements(symbol),
              fundamentals.monthlyRevenue(symbol),
              fundamentals.dividends(symbol),
            ]);

            const today = exchangeDate(symbol.market, at);

            return upcomingEvents(
              symbol,
              { statements, monthlyRevenue, dividends },
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
