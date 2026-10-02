import { compact, uniqBy } from "es-toolkit";
import { Firecrawl } from "firecrawl";
import * as z from "zod";

import { Market, exchangeDate } from "@solyx/core/market";
import type { NewsItem, NewsQuery, NewsSource } from "@solyx/core/news";

/** Firecrawl's hosted API; passed so the SDK never reads `FIRECRAWL_API_URL`. */
const FIRECRAWL_API_URL = "https://api.firecrawl.dev";

// Google News ranks results for the searcher's location.
const MARKET_LOCATION: Record<Market, string> = {
  [Market.TW]: "Taiwan",
  [Market.US]: "United States",
};

const newsResultSchema = z.object({
  url: z.url(),
  title: z.string().trim().min(1),
  snippet: z.string().trim().catch(""),
  date: z.string().optional().catch(undefined),
});

const AGE_PATTERN = /^(\d+)\s+(minute|hour|day|week)s?\s+ago$/i;

const UNIT_MS = new Map([
  ["minute", 60_000],
  ["hour", 3_600_000],
  ["day", 86_400_000],
  ["week", 604_800_000],
]);

/** Reads Google News's ages, such as `3 hours ago`, and dates such as `Sep 29, 2026`. */
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

export interface FirecrawlNewsOptions {
  apiKey: string;
  /** @default () => new Date() */
  now?: () => Date;
}

/** Google News results through Firecrawl's search, on the user's own key. */
export function createFirecrawlNews(options: FirecrawlNewsOptions): NewsSource {
  const client = new Firecrawl({
    apiKey: options.apiKey,
    apiUrl: FIRECRAWL_API_URL,
  });

  const now = options.now ?? (() => new Date());

  return {
    id: "firecrawl",

    async search({ symbol, listing, since, limit }: NewsQuery) {
      const at = now();

      const { news = [] } = await client.search(
        compact([listing?.name, symbol.symbol]).join(" "),
        {
          sources: ["news"],
          limit,
          location: MARKET_LOCATION[symbol.market],
          tbs: `cdr:1,cd_min:${rangeDate(symbol.market, since)},cd_max:${rangeDate(symbol.market, at)}`,
          // The snippets as published, rather than excerpts Firecrawl picks for the query.
          highlights: false,
        }
      );

      const items = news.flatMap((result): NewsItem[] => {
        const parsed = newsResultSchema.safeParse(result);

        if (!parsed.success) return [];

        const { url, title, snippet, date } = parsed.data;

        return [
          {
            url,
            title,
            snippet,
            site: new URL(url).hostname.replace(/^www\./, ""),
            publishedAt: publishedAt(date, at),
          },
        ];
      });

      return uniqBy(items, (item) => item.url);
    },
  };
}
