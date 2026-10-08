import type { UpcomingEvents } from "@solyx/core/calendar";
import type { SymbolRef } from "@solyx/core/market";

export interface CalendarApi {
  /** The listings' events and their markets' releases over the next `days` days, each from today on its exchange's calendar. */
  upcoming(symbols: SymbolRef[], days: number): Promise<UpcomingEvents>;
}

export const calendarChannels = {
  upcoming: "calendar:upcoming",
} as const satisfies Record<keyof CalendarApi, string>;
