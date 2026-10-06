import * as z from "zod";

import type { Market } from "./market.ts";
import type { Published } from "./news.ts";

/** Which of a search engine's indexes a search reads. */
export const WebSearchKind = {
  /** News outlets' articles. */
  News: "news",
  /** Every page the engine indexed, posts on social networks among them. */
  Web: "web",
} as const;

export type WebSearchKind = (typeof WebSearchKind)[keyof typeof WebSearchKind];

export const webSearchKindSchema = z.enum(WebSearchKind);

export interface WebSearchQuery {
  text: string;
  kind: WebSearchKind;
  /** The earliest publication day to include, on the market's calendar or, without one, UTC's. */
  since: Date;
  /** Hosts to search within, such as `threads.com`; empty searches every host. */
  sites: readonly string[];
  /** Ranks results for the market's country and reads dates on its calendar; `null` for neither. */
  market: Market | null;
  limit: number;
}

/** A page a web search found. */
export interface WebResult {
  url: string;
  title: string;
  /** What the vendor shows of the page, as published rather than excerpts picked for the query. */
  snippet: string;
  /** The host it was published on, without `www.`. */
  site: string;
  /** `null` when the vendor gives no time it can be read from. */
  published: Published | null;
}

/**
 * Searches the web through one vendor on the user's key; one implementation per vendor
 * (`@solyx/web-search/*`), main process only.
 */
export interface WebSearch {
  /**
   * Up to `limit` results in the vendor's order, each address once. Results known to be published
   * before `since` are left out; undated ones may stay. Rejects with a message naming the vendor.
   */
  search(query: WebSearchQuery): Promise<WebResult[]>;
}

/** A page's main content, without its navigation and other chrome. */
export interface WebPage {
  url: string;
  /** `null` when the vendor found none. */
  title: string | null;
  /** Markdown where the vendor gives it, otherwise plain text. */
  text: string;
}

/** Reads a page through one vendor on the user's key; main process only. */
export interface WebReader {
  /** Rejects with a message naming the vendor when it cannot read the page. */
  read(url: string): Promise<WebPage>;
}
