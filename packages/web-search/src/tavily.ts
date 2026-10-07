import * as z from "zod";

import { Market, shiftDate } from "@solyx/core/market";
import type { Published } from "@solyx/core/news";
import { WebSearchKind } from "@solyx/core/web-search";
import type {
  WebReader,
  WebResult,
  WebSearch,
  WebSearchQuery,
} from "@solyx/core/web-search";

import { calendarDate, onDay, site, vendorHttp, within } from "./vendor.ts";

/** Tavily's hosted API. */
const TAVILY_API_URL = "https://api.tavily.com/";

// Tavily boosts a country's results in general searches only; news searches take none.
const MARKET_COUNTRY: Record<Market, string> = {
  [Market.TW]: "taiwan",
  [Market.US]: "united states",
};

// Tavily's `content` is excerpts it picks for the query, so the start of the page's text stands in.
const SNIPPET_CHARACTERS = 400;

const resultSchema = z.object({
  url: z.url(),
  title: z.string().trim().min(1),
  published_date: z.string().nullish().catch(undefined),
  raw_content: z.string().nullish().catch(undefined),
});

const searchResponseSchema = z.object({
  results: z.array(z.unknown()),
});

const extractResponseSchema = z.object({
  results: z.array(z.object({ raw_content: z.string() })).catch([]),
  failed_results: z.array(z.object({ error: z.string() })).catch([]),
});

/** Tavily's dates are its estimates, sometimes of when a page was last updated, so each reads as its day. */
function published(
  date: string | null | undefined,
  market: Market | null
): Published | null {
  if (!date) return null;

  const at = new Date(date);

  if (Number.isNaN(at.getTime())) return null;

  return onDay(market, calendarDate(market, at));
}

export interface TavilyOptions {
  apiKey: string;
  /** @default globalThis.fetch */
  fetch?: typeof globalThis.fetch;
}

/** Tavily's search and extract, on the user's key. */
export function createTavily(options: TavilyOptions): WebSearch & WebReader {
  const http = vendorHttp("Tavily", {
    baseUrl: TAVILY_API_URL,
    headers: { Authorization: `Bearer ${options.apiKey}` },
    fetch: options.fetch,
  });

  return {
    async search(query: WebSearchQuery) {
      const { text, kind, since, sites, market, limit } = query;
      const first = calendarDate(market, since);

      const response = searchResponseSchema.parse(
        await http
          .post("search", {
            json: {
              query: text,
              topic: kind === WebSearchKind.News ? "news" : "general",
              max_results: limit,
              // A day early, since Tavily does not say whose calendar its days are on; the first day is kept below.
              start_date: shiftDate(first, -1),
              include_published_date: true,
              ...(sites.length > 0 && { include_domains: sites }),
              ...(market &&
                kind === WebSearchKind.Web && {
                  country: MARKET_COUNTRY[market],
                }),
              include_raw_content: "text",
            },
          })
          .json()
      );

      const results = response.results.flatMap((result): WebResult[] => {
        const parsed = resultSchema.safeParse(result);

        if (!parsed.success) return [];

        const { url, title, published_date, raw_content } = parsed.data;

        return [
          {
            url,
            title,
            snippet: (raw_content ?? "")
              .replace(/\s+/g, " ")
              .slice(0, SNIPPET_CHARACTERS)
              .trim(),
            site: site(url),
            published: published(published_date, market),
          },
        ];
      });

      return within(query, results);
    },

    async read(url: string) {
      const response = extractResponseSchema.parse(
        await http
          .post("extract", { json: { urls: [url], format: "markdown" } })
          .json()
      );

      const [page] = response.results;

      if (!page) {
        const reason = response.failed_results[0]?.error;

        throw new Error(
          `Tavily could not read ${url}${reason ? `: ${reason}` : ""}`
        );
      }

      return { url, title: null, text: page.raw_content };
    },
  };
}
