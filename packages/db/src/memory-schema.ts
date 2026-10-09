import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import type { Market } from "@solyx/core/market";
import type { MemoryKind } from "@solyx/core/memory";

import { passageVectorsTable } from "./vectors.ts";

// drizzle-kit generates ../migrations/memory from these tables. The full-text index,
// `memory_terms`, is a custom migration, since drizzle has no virtual tables.

/** What the agent keeps across conversations; `id` is the rowid `memory_terms` indexes it under. */
export const memories = sqliteTable("memories", {
  id: integer().primaryKey(),
  /** The memory's own id, which the agent and the user name it by. */
  key: text().notNull().unique(),
  kind: text().$type<MemoryKind>().notNull(),
  /** Set exactly when `symbol` is, for a memory about one listing. */
  market: text().$type<Market>(),
  symbol: text(),
  description: text().notNull(),
  body: text().notNull(),
  /** Unix milliseconds. */
  createdAt: integer("created_at").notNull(),
  /** Unix milliseconds. */
  updatedAt: integer("updated_at").notNull(),
  source: text(),
});

/** The vector of each memory's text, by the text, in one space at a time. */
export const memoryVectors = passageVectorsTable("memory_vectors");
