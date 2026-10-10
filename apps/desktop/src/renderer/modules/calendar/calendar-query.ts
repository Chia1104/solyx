import { queryOptions } from "@tanstack/react-query";

import { symbolKey } from "@solyx/core/market";
import type { SymbolRef } from "@solyx/core/market";

/** How far ahead the overview's calendar looks, the most the main process serves. */
export const CALENDAR_DAYS = 90;

const all = ["calendar"] as const;

export const calendarQueryKeys = {
  all,
  upcoming: (symbols: SymbolRef[]) =>
    [...all, "upcoming", symbols.map(symbolKey)] as const,
};

/** Goes stale on its own, since nothing pushes when a listing's fundamentals change. */
export const upcomingEventsQuery = (symbols: SymbolRef[]) =>
  queryOptions({
    queryKey: calendarQueryKeys.upcoming(symbols),
    queryFn: () => window.solyx.calendar.upcoming(symbols, CALENDAR_DAYS),
  });
