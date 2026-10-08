import { sortBy } from "es-toolkit";

import { upcomingEvents } from "@solyx/core/calendar";
import type { Fundamentals } from "@solyx/core/fundamentals";
import { exchangeDate, shiftDate } from "@solyx/core/market";
import type { SymbolRef } from "@solyx/core/market";

import type { UpcomingEvents } from "#shared/ipc/calendar.ts";

export interface CalendarOptions {
  fundamentals: Fundamentals;
  /** @default () => new Date() */
  now?: () => Date;
}

/**
 * Listings' events as their fundamentals tell them, read through the fundamentals module, which
 * keeps each listing's answer for half a day.
 */
export function createCalendar({
  fundamentals,
  now = () => new Date(),
}: CalendarOptions) {
  return {
    /** One listing failing to read leaves the others' events, and names it among `unread`. */
    async upcoming(
      symbols: readonly SymbolRef[],
      days: number
    ): Promise<UpcomingEvents> {
      const at = now();

      const read = await Promise.allSettled(
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
      );

      return {
        events: sortBy(
          read.flatMap((each) =>
            each.status === "fulfilled" ? each.value : []
          ),
          [({ date }) => date]
        ),
        unread: symbols.filter((_, index) => read[index].status === "rejected"),
      };
    },
  };
}

export type Calendar = ReturnType<typeof createCalendar>;
