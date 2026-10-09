import {
  integer,
  real,
  sqliteTable,
  text,
  unique,
} from "drizzle-orm/sqlite-core";

import type { Forecast, ForecastOutcome } from "@solyx/core/forecast";
import type { Market } from "@solyx/core/market";
import type { TimePrecision } from "@solyx/core/news";
import type { Report } from "@solyx/core/report";

import { passageVectorsTable } from "./vectors.ts";

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

/** Every news item a revision's falsifiers were read against, once per falsifier and item. */
export const falsifierChecks = sqliteTable(
  "falsifier_checks",
  {
    id: integer().primaryKey(),
    market: text().$type<Market>().notNull(),
    symbol: text().notNull(),
    revision: integer().notNull(),
    falsifier: text().notNull(),
    source: text().notNull(),
    /** The source's own id for the item. */
    itemKey: text("item_key").notNull(),
    title: text().notNull(),
    url: text(),
    site: text().notNull(),
    /** Unix milliseconds; `null` when the source gave no time. */
    publishedAt: integer("published_at"),
    /** Set exactly when `publishedAt` is. */
    publishedPrecision: text("published_precision").$type<TimePrecision>(),
    model: text().notNull(),
    supported: real().notNull(),
    /** Unix milliseconds. */
    checkedAt: integer("checked_at").notNull(),
  },
  (table) => [
    unique().on(
      table.market,
      table.symbol,
      table.revision,
      table.falsifier,
      table.source,
      table.itemKey
    ),
  ]
);

/**
 * The vector of each passage of research, by its text, in one space at a time: a revision carries
 * most passages over unchanged, so each is embedded once.
 */
export const passageVectors = passageVectorsTable("passage_vectors");
