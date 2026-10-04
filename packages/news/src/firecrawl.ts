import { compact, uniqBy } from "es-toolkit";
import { Firecrawl } from "firecrawl";
import * as z from "zod";

import { Market, exchangeDate } from "@solyx/core/market";
import { NewsChannel } from "@solyx/core/news";
import type { NewsItem, NewsQuery, NewsSource } from "@solyx/core/news";

/** Firecrawl's hosted API; passed so the SDK never reads `FIRECRAWL_API_URL`. */
const FIRECRAWL_API_URL = "https://api.firecrawl.dev";

// Google ranks results for the searcher's location.
const MARKET_LOCATION: Record<Market, string> = {
  [Market.TW]: "Taiwan",
  [Market.US]: "United States",
};

// Taiwan's investors talk on Threads more than on X; US investors tag tickers on X.
const SOCIAL_SITE: Record<Market, string> = {
  [Market.TW]: "threads.com",
  [Market.US]: "x.com",
};

const newsResultSchema = z.object({
  url: z.url(),
  title: z.string().trim().min(1),
  snippet: z.string().trim().catch(""),
  date: z.string().optional().catch(undefined),
});

const webResultSchema = z.object({
  url: z.url(),
  title: z.string().trim().min(1),
  description: z.string().trim().catch(""),
});

const AGE_PATTERN = /^(\d+)\s+(minute|hour|day|week)s?\s+ago$/i;

const UNIT_MS = new Map([
  ["minute", 60_000],
  ["hour", 3_600_000],
  ["day", 86_400_000],
  ["week", 604_800_000],
]);

// Google starts a dated web result's description with its date: `22 hours ago · …`.
const DATED_DESCRIPTION = /^(.{1,40}?) · ([\s\S]*)$/;

/** Reads Google's ages, such as `3 hours ago`, and dates such as `Sep 29, 2026`. */
function publishedAt(date: string | undefined, now: Date): Date | null {
  if (date === undefined) return null;

  const age = AGE_PATTERN.exec(date.trim());
  const unitMs = age ? UNIT_MS.get(age[2].toLowerCase()) : undefined;

  if (age && unitMs !== undefined) {
    return new Date(now.getTime() - Number(age[1]) * unitMs);
  }

  const parsed = Date.parse(date);

  return Number.isNaN(parsed) ? null : new Date(parsed);
}

/** The exchange-local date as Google's date range reads it, `M/D/YYYY`. */
function rangeDate(market: Market, at: Date): string {
  const [year, month, day] = exchangeDate(market, at).split("-");

  return `${Number(month)}/${Number(day)}/${year}`;
}

const site = (url: string) => new URL(url).hostname.replace(/^www\./, "");

export interface FirecrawlOptions {
  apiKey: string;
  /** @default () => new Date() */
  now?: () => Date;
}

/** Searches through Firecrawl on the user's key, within the query's dates and market. */
function firecrawlSearch(options: FirecrawlOptions) {
  const client = new Firecrawl({
    apiKey: options.apiKey,
    apiUrl: FIRECRAWL_API_URL,
  });

  const now = options.now ?? (() => new Date());

  return async (
    text: string,
    { symbol, since, limit }: NewsQuery,
    source: "news" | "web"
  ) => {
    const at = now();

    const data = await client.search(text, {
      sources: [source],
      limit,
      location: MARKET_LOCATION[symbol.market],
      tbs: `cdr:1,cd_min:${rangeDate(symbol.market, since)},cd_max:${rangeDate(symbol.market, at)}`,
      // The text as published, rather than excerpts Firecrawl picks for the query.
      highlights: false,
    });

    return { data, at };
  };
}

/** Google News articles through Firecrawl's search. */
export function createFirecrawlNews(options: FirecrawlOptions): NewsSource {
  const search = firecrawlSearch(options);

  return {
    id: "firecrawl-news",
    channel: NewsChannel.Article,
    markets: Object.values(Market),

    async search(query: NewsQuery) {
      const { data, at } = await search(
        compact([query.listing?.name, query.symbol.symbol]).join(" "),
        query,
        "news"
      );

      const items = (data.news ?? []).flatMap((result): NewsItem[] => {
        const parsed = newsResultSchema.safeParse(result);

        if (!parsed.success) return [];

        const { url, title, snippet, date } = parsed.data;

        return [
          {
            url,
            title,
            snippet,
            site: site(url),
            publishedAt: publishedAt(date, at),
            votes: null,
          },
        ];
      });

      return uniqBy(items, (item) => item.url);
    },
  };
}

/**
 * Posts on Threads in Taiwan and on X in the US, as Google indexed them: a sample that leans to
 * popular accounts and lags by hours, not every post.
 */
export function createFirecrawlSocial(options: FirecrawlOptions): NewsSource {
  const search = firecrawlSearch(options);

  return {
    id: "firecrawl-social",
    channel: NewsChannel.Social,
    markets: Object.values(Market),

    async search(query: NewsQuery) {
      const { symbol, listing } = query;

      const subject =
        symbol.market === Market.US
          ? `$${symbol.symbol}`
          : (listing?.name ?? symbol.symbol);

      const { data, at } = await search(
        `${subject} site:${SOCIAL_SITE[symbol.market]}`,
        query,
        "web"
      );

      const items = (data.web ?? []).flatMap((result): NewsItem[] => {
        const parsed = webResultSchema.safeParse(result);

        if (!parsed.success) return [];

        const { url, title, description } = parsed.data;
        const dated = DATED_DESCRIPTION.exec(description);
        const date = dated ? publishedAt(dated[1], at) : null;

        return [
          {
            url,
            title,
            snippet: date && dated ? dated[2].trim() : description,
            site: site(url),
            publishedAt: date,
            votes: null,
          },
        ];
      });

      return uniqBy(items, (item) => item.url);
    },
  };
}
