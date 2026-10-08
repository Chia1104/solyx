import * as z from "zod";

import { symbolRefSchema } from "@solyx/core/market";

import { calendarChannels } from "#shared/ipc/calendar.ts";
import type { CalendarApi } from "#shared/ipc/calendar.ts";

import { bindIpc } from "../../ipc/ipc-module.ts";
import type { Services } from "../../services.ts";

const schemas = {
  upcoming: z.tuple([
    z.array(symbolRefSchema).max(500),
    z.number().int().min(1).max(90),
  ]),
};

export function registerCalendarIpc({ calendar }: Services) {
  bindIpc<CalendarApi>(calendarChannels, schemas, {
    upcoming: (symbols, days) => calendar.upcoming(symbols, days),
  });
}
