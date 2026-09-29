import { integer, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";

import type { Market } from "@solyx/core/market";

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
