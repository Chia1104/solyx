import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import type { NodeSQLiteDatabase } from "drizzle-orm/node-sqlite";

import type { SymbolRef } from "@solyx/core/market";
import type { NewsRecord, NewsStore } from "@solyx/core/news";

import { connect } from "./connection.ts";
import { listingNews, newsItems } from "./news-schema.ts";

type ItemRow = typeof newsItems.$inferSelect;

type ListingRow = typeof listingNews.$inferSelect;

function toRecord(item: ItemRow, listing: ListingRow): NewsRecord {
  const { model, relevance, stance, kind, topic } = listing;

  return {
    source: item.source,
    channel: item.channel,
    item: {
      id: item.key,
      url: item.url,
      title: item.title,
      snippet: item.snippet,
      site: item.site,
      publishedAt:
        item.publishedAt === null ? null : new Date(item.publishedAt),
      votes: item.votes,
    },
    foundAt: new Date(listing.foundAt),
    score:
      model === null ||
      relevance === null ||
      stance === null ||
      kind === null ||
      topic === null
        ? null
        : { model, relevance, stance, kind, topic },
  };
}

function newsStore(db: NodeSQLiteDatabase): NewsStore {
  const ofListing = (symbol: SymbolRef) =>
    and(
      eq(listingNews.market, symbol.market),
      eq(listingNews.symbol, symbol.symbol)
    );

  // Undated items are listed by when they were found.
  const listedAt = sql<number>`coalesce(${newsItems.publishedAt}, ${listingNews.foundAt})`;

  return {
    save(symbol, source, items, foundAt) {
      db.transaction((tx) => {
        for (const item of items) {
          const stored = tx
            .insert(newsItems)
            .values({
              source: source.id,
              channel: source.channel,
              key: item.id,
              url: item.url,
              title: item.title,
              snippet: item.snippet,
              site: item.site,
              publishedAt: item.publishedAt?.getTime() ?? null,
              votes: item.votes,
            })
            .onConflictDoUpdate({
              target: [newsItems.source, newsItems.key],
              set: {
                url: sql`excluded.url`,
                title: sql`excluded.title`,
                snippet: sql`excluded.snippet`,
                // Ages such as "6 hours ago" read a little differently on every search.
                publishedAt: sql`coalesce(${newsItems.publishedAt}, excluded.published_at)`,
                votes: sql`excluded.votes`,
              },
            })
            .returning({ id: newsItems.id })
            .get();

          tx.insert(listingNews)
            .values({
              itemId: stored.id,
              market: symbol.market,
              symbol: symbol.symbol,
              foundAt: foundAt.getTime(),
            })
            .onConflictDoNothing()
            .run();
        }
      });
    },

    saveScore(symbol, record, score) {
      const item = db
        .select({ id: newsItems.id })
        .from(newsItems)
        .where(
          and(
            eq(newsItems.source, record.source),
            eq(newsItems.key, record.item.id)
          )
        );

      db.update(listingNews)
        .set({
          model: score.model,
          relevance: score.relevance,
          stance: score.stance,
          kind: score.kind,
          topic: score.topic,
        })
        .where(and(ofListing(symbol), inArray(listingNews.itemId, item)))
        .run();
    },

    list: (symbol, since) =>
      db
        .select()
        .from(listingNews)
        .innerJoin(newsItems, eq(listingNews.itemId, newsItems.id))
        .where(and(ofListing(symbol), gte(listedAt, since.getTime())))
        .orderBy(desc(listedAt))
        .all()
        .map((row) => toRecord(row.news_items, row.listing_news)),
  };
}

/**
 * What news sources found for each listing and how it was scored. Sources reach back only days,
 * so like the user's database it is never deleted, and a file its migrations cannot open is an
 * error. `migrationsFolder` is `migrations/news` wherever the host ships it.
 */
export function openNews(path: string, migrationsFolder: string) {
  const connection = connect(path, migrationsFolder);

  return {
    store: newsStore(connection.db),
    close: () => connection.client.close(),
  };
}

export type NewsData = ReturnType<typeof openNews>;
