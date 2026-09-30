import { integer, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";

import type { TranscriptEntry } from "@solyx/agent/transcript";
import type { Market } from "@solyx/core/market";
import type { OrderRequest } from "@solyx/core/order";
import type {
  ProposalSource,
  ProposalStatus,
  SubmissionFailure,
} from "@solyx/core/order-desk";
import type { RiskViolation } from "@solyx/core/risk";

// drizzle-kit generates ../migrations/user from these tables.

/** Watched listings; ids grow with each addition, so they also keep the user's order. */
export const watchlist = sqliteTable(
  "watchlist",
  {
    id: integer().primaryKey(),
    market: text().$type<Market>().notNull(),
    symbol: text().notNull(),
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

/** Conversations with the agent; `seq` only orders rows, the domain id is `id`. */
export const agentSessions = sqliteTable("agent_sessions", {
  seq: integer().primaryKey(),
  id: text().notNull().unique(),
  title: text().notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

/** Each conversation's messages in the order they were made, as pi's own JSON. */
export const agentMessages = sqliteTable(
  "agent_messages",
  {
    seq: integer().primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => agentSessions.id, { onDelete: "cascade" }),
    id: text().notNull(),
    message: text({ mode: "json" })
      .$type<TranscriptEntry["message"]>()
      .notNull(),
  },
  (table) => [unique().on(table.sessionId, table.id)]
);
