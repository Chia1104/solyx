import type { ListingEvent } from "@solyx/core/calendar";
import type { MacroRelease } from "@solyx/core/macro";
import type { Market, SymbolRef } from "@solyx/core/market";

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

export interface CalendarApi {
  /** The listings' events and their markets' releases over the next `days` days, each from today on its exchange's calendar. */
  upcoming(symbols: SymbolRef[], days: number): Promise<UpcomingEvents>;
}

export const calendarChannels = {
  upcoming: "calendar:upcoming",
} as const satisfies Record<keyof CalendarApi, string>;
