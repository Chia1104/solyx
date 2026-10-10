import {
  integer,
  real,
  sqliteTable,
  text,
  unique,
} from "drizzle-orm/sqlite-core";

import type { Market } from "@solyx/core/market";
import type { TimePrecision } from "@solyx/core/news";
import type {
  AccountSnapshot,
  OrderRequest,
  Position,
} from "@solyx/core/order";
import type {
  ProposalSource,
  ProposalStatus,
  SubmissionFailure,
} from "@solyx/core/order-desk";
import type { RiskViolation } from "@solyx/core/risk";
import type {
  Schedule,
  ScheduleApproval,
  ScheduledRun,
} from "@solyx/core/schedule";
import type { ThemeDraft } from "@solyx/core/theme";

// drizzle-kit generates ../migrations/user from these tables.

/** Watched listings in the user's order: by `position`, then by `id`, which grows with each addition. */
export const watchlist = sqliteTable(
  "watchlist",
  {
    id: integer().primaryKey(),
    market: text().$type<Market>().notNull(),
    symbol: text().notNull(),
    position: integer().notNull().default(0),
  },
  (table) => [unique().on(table.market, table.symbol)]
);

/** Every trade proposal and what became of it; `seq` keeps the order they were made in. */
export const proposals = sqliteTable("proposals", {
  seq: integer().primaryKey(),
  id: text().notNull().unique(),
  order: text("order_request", { mode: "json" })
    .$type<OrderRequest>()
    .notNull(),
  source: text().$type<ProposalSource>().notNull(),
  rationale: text().notNull(),
  createdAt: integer("created_at").notNull(),
  status: text().$type<ProposalStatus>().notNull(),
  violations: text({ mode: "json" }).$type<RiskViolation[]>().notNull(),
  brokerOrderId: text("broker_order_id"),
  failure: text({ mode: "json" }).$type<SubmissionFailure>(),
});

/** The paper account, in one row: what it holds and how many orders it filled. */
export const paperAccount = sqliteTable("paper_account", {
  id: integer().primaryKey(),
  cash: text({ mode: "json" }).$type<AccountSnapshot["cash"]>().notNull(),
  positions: text({ mode: "json" }).$type<Position[]>().notNull(),
  orders: integer().notNull(),
});

/** Every scheduled task as the user wrote it, and its last run; `seq` keeps the order they were made in. */
export const scheduledTasks = sqliteTable("scheduled_tasks", {
  seq: integer().primaryKey(),
  id: text().notNull().unique(),
  name: text().notNull(),
  prompt: text().notNull(),
  schedule: text({ mode: "json" }).$type<Schedule>().notNull(),
  timeZone: text("time_zone").notNull(),
  locale: text().notNull(),
  approval: text().$type<ScheduleApproval>().notNull(),
  enabled: integer({ mode: "boolean" }).notNull(),
  /** Unix milliseconds. */
  createdAt: integer("created_at").notNull(),
  /** Unix milliseconds. */
  updatedAt: integer("updated_at").notNull(),
  lastRun: text("last_run", { mode: "json" }).$type<ScheduledRun>(),
});

/** Every theme as it is written, and when its searches last ran; `seq` keeps the order they were made in. */
export const themes = sqliteTable("themes", {
  seq: integer().primaryKey(),
  id: text().notNull().unique(),
  theme: text({ mode: "json" }).$type<ThemeDraft>().notNull(),
  /** Unix milliseconds. */
  createdAt: integer("created_at").notNull(),
  /** Unix milliseconds. */
  updatedAt: integer("updated_at").notNull(),
  /** Unix milliseconds; `null` before its first search. */
  collectedAt: integer("collected_at"),
});

/** Every news item a theme's searches found, once per theme. */
export const themeItems = sqliteTable(
  "theme_items",
  {
    id: integer().primaryKey(),
    themeId: text("theme_id")
      .notNull()
      .references(() => themes.id, { onDelete: "cascade" }),
    /** The item's own id, such as its address. */
    key: text().notNull(),
    url: text(),
    title: text().notNull(),
    snippet: text().notNull(),
    site: text().notNull(),
    /** Unix milliseconds; `null` when the source gave no time. */
    publishedAt: integer("published_at"),
    /** Set exactly when `publishedAt` is. */
    publishedPrecision: text("published_precision").$type<TimePrecision>(),
    /** Unix milliseconds. */
    foundAt: integer("found_at").notNull(),
  },
  (table) => [unique().on(table.themeId, table.key)]
);

/** Each reading of an item against a theme's signpost, kept once. */
export const themeReadings = sqliteTable(
  "theme_readings",
  {
    id: integer().primaryKey(),
    themeId: text("theme_id")
      .notNull()
      .references(() => themes.id, { onDelete: "cascade" }),
    signpost: text().notNull(),
    itemKey: text("item_key").notNull(),
    model: text().notNull(),
    supported: real().notNull(),
    /** Unix milliseconds. */
    checkedAt: integer("checked_at").notNull(),
  },
  (table) => [unique().on(table.themeId, table.signpost, table.itemKey)]
);
