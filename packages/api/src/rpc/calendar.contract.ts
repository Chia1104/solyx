import { oc, type } from "@orpc/contract";
import * as z from "zod";

import type { ListingEvents, ResearchEvent } from "@solyx/core/calendar";
import type { MacroRelease } from "@solyx/core/macro";
import { marketSchema, symbolRefSchema } from "@solyx/core/market";
import type { MarketClosure } from "@solyx/core/session";

import { forDevices } from "./access.ts";

const daysSchema = z.number().int().min(1).max(90);

const marketDaysSchema = z.object({ market: marketSchema, days: daysSchema });

/** Each part is read on its own, so a source slow to answer or out of its limit holds up only its own. */
export const calendarContract = {
  /** A listing's events over the next `days` days, from today on its exchange's calendar. */
  listing: oc
    .meta(forDevices(true))
    .input(z.object({ symbol: symbolRefSchema, days: daysSchema }))
    .output(type<ListingEvents>()),
  /** The dates the listings' reports in force hold over the next `days` days, soonest first. */
  research: oc
    .meta(forDevices(true))
    .input(
      z.object({ symbols: z.array(symbolRefSchema).max(500), days: daysSchema })
    )
    .output(type<ResearchEvent[]>()),
  /** A market's economic releases from `RELEASED_DAYS` back through the next `days` days, soonest first. */
  releases: oc
    .meta(forDevices(true))
    .input(marketDaysSchema)
    .output(type<MacroRelease[]>()),
  /** The weekdays a market is closed over the next `days` days, soonest first. */
  closures: oc
    .meta(forDevices(true))
    .input(marketDaysSchema)
    .output(type<MarketClosure[]>()),
};
