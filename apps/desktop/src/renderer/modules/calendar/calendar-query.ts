import type { SymbolRef } from "@solyx/core/market";

import { orpc } from "../../app/rpc.ts";

/** How far ahead the overview's calendar looks, the most the main process serves. */
export const CALENDAR_DAYS = 90;

/** Goes stale on its own, since nothing pushes when a listing's fundamentals change. */
export const upcomingEventsQuery = (symbols: SymbolRef[]) =>
  orpc.calendar.upcoming.queryOptions({
    input: { symbols: symbols, days: CALENDAR_DAYS },
  });
