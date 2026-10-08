import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  unique,
} from "drizzle-orm/sqlite-core";

import type { Market } from "@solyx/core/market";
import type { NewsChannel, TimePrecision } from "@solyx/core/news";
import type {
  Stance,
  TextKind,
  TextSpeaker,
  TextTopic,
} from "@solyx/core/sentiment";

// drizzle-kit generates ../migrations/news from these tables.

/** Every item a source found, once per source; finding it again updates what can change. */
export const newsItems = sqliteTable(
  "news_items",
  {
    id: integer().primaryKey(),
    source: text().notNull(),
    channel: text().$type<NewsChannel>().notNull(),
    /** The source's own id for it. */
    key: text().notNull(),
    url: text(),
    title: text().notNull(),
    snippet: text().notNull(),
    site: text().notNull(),
    /** Unix milliseconds; `null` when the source gives no time. */
    publishedAt: integer("published_at"),
    votes: integer(),
    /** Set exactly when `publishedAt` is. */
    publishedPrecision: text("published_precision").$type<TimePrecision>(),
  },
  (table) => [unique().on(table.source, table.key)]
);

/**
 * Each listing an item was found for, and the decisions model's reading of it for that listing;
 * the score columns stay `null` until it is scored.
 */
export const listingNews = sqliteTable(
  "listing_news",
  {
    itemId: integer("item_id")
      .notNull()
      .references(() => newsItems.id, { onDelete: "cascade" }),
    market: text().$type<Market>().notNull(),
    symbol: text().notNull(),
    /** Unix milliseconds of the first search that found it for the listing. */
    foundAt: integer("found_at").notNull(),
    model: text(),
    relevance: real(),
    stance: text({ mode: "json" }).$type<Record<Stance, number>>(),
    kind: text({ mode: "json" }).$type<Record<TextKind, number>>(),
    topic: text({ mode: "json" }).$type<Record<TextTopic, number>>(),
    speaker: text({ mode: "json" }).$type<Record<TextSpeaker, number>>(),
  },
  (table) => [
    primaryKey({ columns: [table.itemId, table.market, table.symbol] }),
    index("listing_news_listing").on(table.market, table.symbol),
  ]
);

/** When news was last collected for each listing, so collection runs at the interval the user set. */
export const newsCollections = sqliteTable(
  "news_collections",
  {
    market: text().$type<Market>().notNull(),
    symbol: text().notNull(),
    /** Unix milliseconds. */
    collectedAt: integer("collected_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.market, table.symbol] })]
);

/** How each source's searches have gone, across every listing. */
export const newsSourceHealth = sqliteTable("news_source_health", {
  source: text().primaryKey(),
  /** Unix milliseconds. */
  lastSuccessAt: integer("last_success_at"),
  /** Unix milliseconds. */
  lastFailureAt: integer("last_failure_at"),
  failureStreak: integer("failure_streak").notNull(),
  lastError: text("last_error"),
});
