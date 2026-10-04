import { groupBy, mapAsync } from "es-toolkit";

import type { Listing } from "./market-data.ts";
import type { Market, SymbolRef } from "./market.ts";
import type { SentimentScore, SentimentScorer } from "./sentiment.ts";

/** Where items were published, which decides whose voice they carry. */
export const NewsChannel = {
  /** Material information the company files with the exchange. */
  Announcement: "announcement",
  /** News outlets' articles. */
  Article: "article",
  /** Stock forums, such as PTT's Stock board. */
  Forum: "forum",
  /** Social networks, such as Threads and X. */
  Social: "social",
} as const;

export type NewsChannel = (typeof NewsChannel)[keyof typeof NewsChannel];

/** An announcement, article or post a news source found. */
export interface NewsItem {
  /** Identifies it within its source, such as its address, so finding it again recognizes it. */
  id: string;
  /** `null` when the source has no page for it. */
  url: string | null;
  title: string;
  /** What the source shows of it, such as a search snippet, rather than the whole text. */
  snippet: string;
  /** The host it was published on, without `www.`. */
  site: string;
  /** `null` when the source gives no time it can be read from. */
  publishedAt: Date | null;
  /** Net votes where the source counts them, such as PTT's pushes minus boos. */
  votes: number | null;
}

export interface NewsQuery {
  symbol: SymbolRef;
  /** The exchange's names for it, which articles use more often than the code. */
  listing: Listing | null;
  /** The earliest publication day to include. */
  since: Date;
  limit: number;
}

/** Finds items about a listing; one implementation per source (`@solyx/news/*`), main process only. */
export interface NewsSource {
  readonly id: string;
  readonly channel: NewsChannel;
  readonly markets: readonly Market[];
  search(query: NewsQuery): Promise<NewsItem[]>;
}

/** An item stored for a listing: where it came from and, once judged, the decisions model's reading. */
export interface NewsRecord {
  source: string;
  channel: NewsChannel;
  item: NewsItem;
  /** When a search first found it for the listing. */
  foundAt: Date;
  score: SentimentScore | null;
}

/** Keeps what sources found per listing, so history outlives each source's window. */
export interface NewsStore {
  /**
   * Stores what a source found for a listing. An item stored before keeps its score and takes
   * the latest title, snippet and votes.
   */
  save(
    symbol: SymbolRef,
    source: Pick<NewsSource, "id" | "channel">,
    items: readonly NewsItem[],
    foundAt: Date
  ): void;
  /** Stores the decisions model's reading of a record's item for the listing. */
  saveScore(symbol: SymbolRef, record: NewsRecord, score: SentimentScore): void;
  /** A listing's records published since `since`, or found since then when undated, newest first. */
  list(symbol: SymbolRef, since: Date): NewsRecord[];
}

export interface CollectNewsOptions {
  sources: readonly NewsSource[];
  store: NewsStore;
  /** `undefined` leaves records unscored. */
  scorer: SentimentScorer | undefined;
  query: NewsQuery;
  now: Date;
  /** Requests to the scorer at once. */
  concurrency: number;
}

export interface NewsCollection {
  /** Each channel's newest records, up to the query's limit, newest first. */
  records: NewsRecord[];
  /** Sources whose search failed; what they stored before is still among `records`. */
  failures: { source: string; error: unknown }[];
}

/**
 * Searches every source, stores what each finds, then scores the newest records of each channel
 * that hold no score yet, so an item is judged once however often it is found.
 */
export async function collectNews({
  sources,
  store,
  scorer,
  query,
  now,
  concurrency,
}: CollectNewsOptions): Promise<NewsCollection> {
  // One source failing leaves the others' items, and what it found before, in the collection.
  const results = await Promise.allSettled(
    sources.map((source) => source.search(query))
  );

  const failures: NewsCollection["failures"] = [];

  for (const [index, result] of results.entries()) {
    const source = sources[index];

    if (result.status === "fulfilled") {
      store.save(query.symbol, source, result.value, now);
    } else {
      failures.push({ source: source.id, error: result.reason });
    }
  }

  const newest = Object.values(
    groupBy(store.list(query.symbol, query.since), (record) => record.channel)
  ).flatMap((records) => records.slice(0, query.limit));

  if (!scorer) return { records: newest, failures };

  const records = await mapAsync(
    newest,
    async (record) => {
      if (record.score) return record;

      const score = await scorer.score({
        symbol: query.symbol,
        listing: query.listing,
        title: record.item.title,
        text: record.item.snippet,
      });

      store.saveScore(query.symbol, record, score);

      return { ...record, score };
    },
    { concurrency }
  );

  return { records, failures };
}
