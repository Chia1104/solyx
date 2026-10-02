import type { Listing } from "./market-data.ts";
import type { Market, SymbolRef } from "./market.ts";

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
