import { integer, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";

import type { Market } from "@solyx/core/market";
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
