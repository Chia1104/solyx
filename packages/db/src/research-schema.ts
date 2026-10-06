import { integer, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";

import type { Forecast, ForecastOutcome } from "@solyx/core/forecast";
import type { Market } from "@solyx/core/market";
import type { Report } from "@solyx/core/report";

// drizzle-kit generates ../migrations/research from these tables.

/** Every revision of every listing's report; a listing's newest is the one in force. */
export const reports = sqliteTable(
  "reports",
  {
    id: integer().primaryKey(),
    market: text().$type<Market>().notNull(),
    symbol: text().notNull(),
    revision: integer().notNull(),
    report: text({ mode: "json" }).$type<Report>().notNull(),
  },
  (table) => [unique().on(table.market, table.symbol, table.revision)]
);

/** Every forecast as it was made, and how it came out; `seq` keeps the order they were made in. */
export const forecasts = sqliteTable(
  "forecasts",
  {
    seq: integer().primaryKey(),
    id: text().notNull().unique(),
    market: text().$type<Market>().notNull(),
    symbol: text().notNull(),
    /** Exchange-local date, `YYYY-MM-DD`; a listing takes one forecast per session. */
    anchorDate: text("anchor_date").notNull(),
    forecast: text({ mode: "json" })
      .$type<Omit<Forecast, "outcome">>()
      .notNull(),
    outcome: text({ mode: "json" }).$type<ForecastOutcome>(),
  },
  (table) => [unique().on(table.market, table.symbol, table.anchorDate)]
);
