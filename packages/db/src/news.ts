import { and, asc, count, desc, eq, gte, inArray, ne, sql } from "drizzle-orm";
import type { NodeSQLiteDatabase } from "drizzle-orm/node-sqlite";
import { groupBy, keyBy } from "es-toolkit";

import { clearlyNearest, cosine } from "@solyx/core/embedding";
import type { SymbolRef } from "@solyx/core/market";
import type {
  NewsItem,
  NewsMatch,
  NewsRecord,
  NewsStore,
} from "@solyx/core/news";

import { connect } from "./connection.ts";
import { databaseBytes } from "./database-file.ts";
import { anyTerm, indexedTerms } from "./full-text.ts";
import {
  itemEmbeddings,
  listingNews,
  newsCollections,
  newsItems,
  newsSourceHealth,
} from "./news-schema.ts";
import { toBytes, toValues } from "./vectors.ts";

type ItemRow = typeof newsItems.$inferSelect;

type ListingRow = typeof listingNews.$inferSelect;

function toItem(item: ItemRow): NewsItem {
  return {
    id: item.key,
    url: item.url,
    title: item.title,
    snippet: item.snippet,
    site: item.site,
    published:
      item.publishedAt === null || item.publishedPrecision === null
        ? null
        : {
            at: new Date(item.publishedAt),
            precision: item.publishedPrecision,
          },
    votes: item.votes,
  };
}

/** What `news_terms` holds of an item: the words of its title and snippet. */
function itemTerms(item: Pick<NewsItem, "title" | "snippet">) {
  return indexedTerms([item.title, item.snippet]);
}

/** Indexes the items kept before `news_terms` existed. */
function indexMissing(db: NodeSQLiteDatabase) {
  db.transaction((tx) => {
    for (const row of tx
      .select({
        id: newsItems.id,
        title: newsItems.title,
        snippet: newsItems.snippet,
      })
      .from(newsItems)
      .where(sql`${newsItems.id} NOT IN (SELECT rowid FROM news_terms)`)
      .all()) {
      tx.run(
        sql`INSERT INTO news_terms (rowid, terms) VALUES (${row.id}, ${itemTerms(row)})`
      );
    }
  });
}

type EmbeddingRow = typeof itemEmbeddings.$inferSelect;

function toRecord(
  item: ItemRow,
  listing: ListingRow,
  embedding: EmbeddingRow | null = null
): NewsRecord {
  const { model, relevance, stance, kind, topic, speaker } = listing;

  const record: NewsRecord = {
    source: item.source,
    channel: item.channel,
    item: toItem(item),
    foundAt: new Date(listing.foundAt),
    score:
      model === null ||
      relevance === null ||
      stance === null ||
      kind === null ||
      topic === null ||
      // A score that misses an answer is no score, so the story is scored again when next collected.
      speaker === null
        ? null
        : { model, relevance, stance, kind, topic, speaker },
  };

  if (embedding) {
    record.embedding = {
      space: embedding.space,
      values: toValues(embedding.vector),
    };
  }

  return record;
}

function newsStore(db: NodeSQLiteDatabase): NewsStore {
  const ofListing = (symbol: SymbolRef) =>
    and(
      eq(listingNews.market, symbol.market),
      eq(listingNews.symbol, symbol.symbol)
    );

  // Undated items are listed by when they were found.
  const listedAt = sql<number>`coalesce(${newsItems.publishedAt}, ${listingNews.foundAt})`;

  /** The stored items with these ids, in their order, each with every listing it was found for. */
  function matchesOf(ids: readonly number[]): NewsMatch[] {
    const items = keyBy(
      db
        .select()
        .from(newsItems)
        .where(inArray(newsItems.id, [...ids]))
        .all(),
      (row) => row.id
    );

    const listings = groupBy(
      db
        .select({
          itemId: listingNews.itemId,
          market: listingNews.market,
          symbol: listingNews.symbol,
        })
        .from(listingNews)
        .where(inArray(listingNews.itemId, [...ids]))
        .orderBy(asc(listingNews.foundAt))
        .all(),
      (row) => row.itemId
    );

    return ids.flatMap((id) => {
      const item = items[id];

      if (!item) return [];

      return [
        {
          source: item.source,
          channel: item.channel,
          item: toItem(item),
          listings: (listings[id] ?? []).map(({ market, symbol }) => ({
            market,
            symbol,
          })),
        },
      ];
    });
  }

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
              publishedAt: item.published?.at.getTime() ?? null,
              publishedPrecision: item.published?.precision ?? null,
              votes: item.votes,
            })
            .onConflictDoUpdate({
              target: [newsItems.source, newsItems.key],
              set: {
                url: sql`excluded.url`,
                title: sql`excluded.title`,
                snippet: sql`excluded.snippet`,
                // Ages such as "6 hours ago" read a little differently, and less exactly, on every
                // search, so the first time given is kept with its precision.
                publishedAt: sql`coalesce(${newsItems.publishedAt}, excluded.published_at)`,
                publishedPrecision: sql`case when ${newsItems.publishedAt} is null then excluded.published_precision else ${newsItems.publishedPrecision} end`,
                votes: sql`excluded.votes`,
              },
            })
            .returning({ id: newsItems.id })
            .get();

          tx.run(sql`DELETE FROM news_terms WHERE rowid = ${stored.id}`);
          tx.run(
            sql`INSERT INTO news_terms (rowid, terms) VALUES (${stored.id}, ${itemTerms(item)})`
          );

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
          speaker: score.speaker,
        })
        .where(and(ofListing(symbol), inArray(listingNews.itemId, item)))
        .run();
    },

    list: (symbol, since, space) =>
      db
        .select()
        .from(listingNews)
        .innerJoin(newsItems, eq(listingNews.itemId, newsItems.id))
        .leftJoin(
          itemEmbeddings,
          and(
            eq(itemEmbeddings.itemId, newsItems.id),
            eq(itemEmbeddings.space, space ?? "")
          )
        )
        .where(and(ofListing(symbol), gte(listedAt, since.getTime())))
        .orderBy(desc(listedAt))
        .all()
        .map((row) =>
          toRecord(row.news_items, row.listing_news, row.item_embeddings)
        ),

    saveEmbeddings(space, vectors) {
      db.transaction((tx) => {
        tx.delete(itemEmbeddings).where(ne(itemEmbeddings.space, space)).run();

        for (const { record, values } of vectors) {
          const item = tx
            .select({ id: newsItems.id })
            .from(newsItems)
            .where(
              and(
                eq(newsItems.source, record.source),
                eq(newsItems.key, record.item.id)
              )
            )
            .get();

          if (!item) continue;

          const vector = toBytes(values);

          tx.insert(itemEmbeddings)
            .values({ itemId: item.id, space, vector })
            .onConflictDoUpdate({
              target: itemEmbeddings.itemId,
              set: { space, vector },
            })
            .run();
        }
      });
    },

    lastCollected(symbol) {
      const row = db
        .select({ collectedAt: newsCollections.collectedAt })
        .from(newsCollections)
        .where(
          and(
            eq(newsCollections.market, symbol.market),
            eq(newsCollections.symbol, symbol.symbol)
          )
        )
        .get();

      return row ? new Date(row.collectedAt) : null;
    },

    markCollected(symbol, at) {
      db.insert(newsCollections)
        .values({
          market: symbol.market,
          symbol: symbol.symbol,
          collectedAt: at.getTime(),
        })
        .onConflictDoUpdate({
          target: [newsCollections.market, newsCollections.symbol],
          set: { collectedAt: at.getTime() },
        })
        .run();
    },

    markSearched(source, at, error) {
      const time = at.getTime();

      if (error === null) {
        db.insert(newsSourceHealth)
          .values({ source, lastSuccessAt: time, failureStreak: 0 })
          .onConflictDoUpdate({
            target: newsSourceHealth.source,
            set: { lastSuccessAt: time, failureStreak: 0 },
          })
          .run();

        return;
      }

      db.insert(newsSourceHealth)
        .values({
          source,
          lastFailureAt: time,
          failureStreak: 1,
          lastError: error,
        })
        .onConflictDoUpdate({
          target: newsSourceHealth.source,
          set: {
            lastFailureAt: time,
            failureStreak: sql`${newsSourceHealth.failureStreak} + 1`,
            lastError: error,
          },
        })
        .run();
    },

    sourceHealth: () =>
      db
        .select()
        .from(newsSourceHealth)
        .all()
        .map((row) => ({
          source: row.source,
          lastSuccessAt:
            row.lastSuccessAt === null ? null : new Date(row.lastSuccessAt),
          lastFailureAt:
            row.lastFailureAt === null ? null : new Date(row.lastFailureAt),
          failureStreak: row.failureStreak,
          lastError: row.lastError,
        })),

    nearest(space, query, limit, symbol) {
      const rows = db
        .select({ id: itemEmbeddings.itemId, vector: itemEmbeddings.vector })
        .from(itemEmbeddings)
        .where(
          and(
            eq(itemEmbeddings.space, space),
            symbol &&
              inArray(
                itemEmbeddings.itemId,
                db
                  .select({ id: listingNews.itemId })
                  .from(listingNews)
                  .where(ofListing(symbol))
              )
          )
        )
        .all();

      return matchesOf(
        clearlyNearest(
          rows.map(({ id, vector }) => ({
            item: id,
            similarity: cosine(query, toValues(vector)),
          })),
          limit
        )
      );
    },

    search(query, limit, symbol) {
      const match = anyTerm(query);

      if (match === null) return [];

      const ofListing = symbol
        ? sql`AND news_items.id IN (SELECT item_id FROM listing_news
            WHERE market = ${symbol.market} AND symbol = ${symbol.symbol})`
        : sql``;

      const ranked = db.all<{ id: number }>(
        sql`SELECT news_items.id AS id FROM news_terms
          JOIN news_items ON news_items.id = news_terms.rowid
          WHERE news_terms MATCH ${match} ${ofListing}
          ORDER BY bm25(news_terms), news_items.published_at DESC, news_items.id DESC
          LIMIT ${limit}`
      );

      return matchesOf(ranked.map((row) => row.id));
    },
  };
}

export interface NewsUsage {
  /** The file on disk, with its write-ahead log. */
  bytes: number;
  /** Each counted once, however many listings it was found for. */
  items: number;
}

/**
 * What news sources found for each listing and how it was scored. Sources reach back only days,
 * so like the user's database it is never deleted, and a file its migrations cannot open is an
 * error. `migrationsFolder` is `migrations/news` wherever the host ships it.
 */
export function openNews(path: string, migrationsFolder: string) {
  const { client, db } = connect(path, migrationsFolder);

  indexMissing(db);

  return {
    store: newsStore(db),

    usage(): NewsUsage {
      return {
        bytes: databaseBytes(path),
        items: db.select({ items: count() }).from(newsItems).get()?.items ?? 0,
      };
    },

    /**
     * Deletes every item and its scores, and when each listing was collected, so watched listings
     * collect again; how each source's searches went is kept, so a failing one still rests.
     */
    clear() {
      db.transaction((tx) => {
        tx.delete(newsItems).run();
        tx.delete(newsCollections).run();
        tx.run(sql`INSERT INTO news_terms (news_terms) VALUES ('delete-all')`);
      });
      // VACUUM rewrites the file through the log, so the log is truncated after it.
      client.exec("VACUUM; PRAGMA wal_checkpoint(TRUNCATE);");
    },

    close: () => client.close(),
  };
}

export type NewsData = ReturnType<typeof openNews>;
