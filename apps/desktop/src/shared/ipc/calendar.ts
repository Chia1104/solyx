import type { ListingEvent } from "@solyx/core/calendar";
import type { SymbolRef } from "@solyx/core/market";

export interface UpcomingEvents {
  /** Soonest first. */
  events: ListingEvent[];
  /** Listings whose fundamentals could not be read this time, so their events may be missing. */
  unread: SymbolRef[];
}

export interface CalendarApi {
  /** The listings' events over the next `days` days, each from today on its exchange's calendar. */
  upcoming(symbols: SymbolRef[], days: number): Promise<UpcomingEvents>;
}

export const calendarChannels = {
  upcoming: "calendar:upcoming",
} as const satisfies Record<keyof CalendarApi, string>;
