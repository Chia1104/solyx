import type { Listing } from "./market-data.ts";
import type { SymbolRef } from "./market.ts";

/** An article or post a news source found. */
export interface NewsItem {
  url: string;
  title: string;
  /** What the source shows of it, such as a search snippet, rather than the whole text. */
  snippet: string;
  /** The host it was published on, without `www.`. */
  site: string;
  /** `null` when the source gives no time it can be read from. */
  publishedAt: Date | null;
}

export interface NewsQuery {
  symbol: SymbolRef;
  /** The exchange's names for it, which articles use more often than the code. */
  listing: Listing | null;
  /** The earliest publication day to include. */
  since: Date;
  limit: number;
}

/** Finds news about a listing; one implementation per source (`@solyx/news/*`), main process only. */
export interface NewsSource {
  readonly id: string;
  search(query: NewsQuery): Promise<NewsItem[]>;
}
