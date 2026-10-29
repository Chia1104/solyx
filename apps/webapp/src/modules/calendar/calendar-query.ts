import type { Market, SymbolRef } from "@solyx/core/market";

import { orpc } from "../../app/rpc.ts";

/** How far ahead the overview's calendar looks, the most the main process serves. */
export const CALENDAR_DAYS = 90;

/** Goes stale on its own, since nothing pushes when a listing's fundamentals change. */
export const listingEventsQuery = (symbol: SymbolRef) =>
  orpc.calendar.listing.queryOptions({
    input: { symbol, days: CALENDAR_DAYS },
  });

/** Read again whenever research changes, which tells of an exchange's day turning too. */
export const researchEventsQuery = (symbols: SymbolRef[]) =>
  orpc.calendar.research.queryOptions({
    input: { symbols, days: CALENDAR_DAYS },
    staleTime: Infinity,
  });

/** Goes stale on its own, since nothing pushes when a schedule changes. */
export const releasesQuery = (market: Market) =>
  orpc.calendar.releases.queryOptions({
    input: { market, days: CALENDAR_DAYS },
  });

/** Goes stale on its own, since nothing pushes when an exchange sets a closure. */
export const closuresQuery = (market: Market) =>
  orpc.calendar.closures.queryOptions({
    input: { market, days: CALENDAR_DAYS },
  });
