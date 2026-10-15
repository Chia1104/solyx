import { oc, type } from "@orpc/contract";
import * as z from "zod";

import type { UpcomingEvents } from "@solyx/core/calendar";
import { symbolRefSchema } from "@solyx/core/market";

export const calendarContract = {
  /** The listings' events and their markets' releases over the next `days` days, each from today on its exchange's calendar. */
  upcoming: oc
    .input(
      z.object({
        symbols: z.array(symbolRefSchema).max(500),
        days: z.number().int().min(1).max(90),
      })
    )
    .output(type<UpcomingEvents>()),
};
