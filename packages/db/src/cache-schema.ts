import {
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  unique,
} from "drizzle-orm/sqlite-core";

// drizzle-kit generates ../migrations/cache from these tables.

export const candleSeries = sqliteTable(
  "candle_series",
  {
    id: integer().primaryKey(),
    source: text().notNull(),
    market: text().notNull(),
    symbol: text().notNull(),
    interval: text().notNull(),
    /** Exchange-local dates between which every closed session is stored. */
    coveredFrom: text("covered_from").notNull(),
    coveredTo: text("covered_to").notNull(),
  },
  (table) => [
    unique().on(table.source, table.market, table.symbol, table.interval),
  ]
);

export const candles = sqliteTable(
  "candles",
  {
    seriesId: integer("series_id")
      .notNull()
      .references(() => candleSeries.id, { onDelete: "cascade" }),
    time: integer().notNull(),
    /** The bar's exchange-local session date, so coverage and retention work in dates. */
    date: text().notNull(),
    open: real().notNull(),
    high: real().notNull(),
    low: real().notNull(),
    close: real().notNull(),
    volume: real().notNull(),
  },
  (table) => [primaryKey({ columns: [table.seriesId, table.time] })]
);
