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

/** Exa's hosted API. */
const EXA_API_URL = "https://api.exa.ai/";

const MARKET_COUNTRY: Record<Market, string> = {
  [Market.TW]: "TW",
  [Market.US]: "US",
};

// The start of a page's text stands in for a snippet; Exa bills text by the page, not its length.
const SNIPPET_CHARACTERS = 400;

// Exa writes a date it knows only to the day as midnight UTC.
const DAY_ONLY = /T00:00:00(?:\.0+)?Z$/;

const resultSchema = z.object({
  url: z.url(),
  title: z.string().trim().min(1),
  publishedDate: z.string().optional().catch(undefined),
  text: z.string().catch(""),
});

const searchResponseSchema = z.object({
  results: z.array(z.unknown()),
});

const contentsResponseSchema = z.object({
  results: z.array(
    z.object({
      url: z.string(),
      title: z.string().trim().min(1).nullish().catch(undefined),
      text: z.string(),
    })
  ),
  statuses: z
    .array(
      z.object({
        status: z.string(),
        error: z.object({ tag: z.string() }).nullish().catch(undefined),
      })
    )
    .catch([]),
});

/**
 * Exa's dates are its own estimates and often name only a day, so each reads as the day it names:
 * a midnight-UTC date as written, and an instant as its day on the market's calendar.
 */
function published(
  date: string | undefined,
  market: Market | null
): Published | null {
  if (date === undefined) return null;

  const at = new Date(date);

  if (Number.isNaN(at.getTime())) return null;

  return onDay(
    market,
    DAY_ONLY.test(date) ? date.slice(0, 10) : calendarDate(market, at)
  );
}

export interface ExaOptions {
  apiKey: string;
  /** @default globalThis.fetch */
  fetch?: typeof globalThis.fetch;
}

/** Exa's own index through its search and contents, on the user's key. */
export function createExa(options: ExaOptions): WebSearch & WebReader {
  const http = vendorHttp("Exa", {
    baseUrl: EXA_API_URL,
    headers: { "x-api-key": options.apiKey },
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
              type: "auto",
              numResults: limit,
              ...(kind === WebSearchKind.News && { category: "news" }),
              ...(sites.length > 0 && { includeDomains: sites }),
              // A day early, since a day-only date is midnight UTC; the first day is kept below.
              startPublishedDate: `${shiftDate(first, -1)}T00:00:00.000Z`,
              ...(market && { userLocation: MARKET_COUNTRY[market] }),
              contents: { text: { maxCharacters: SNIPPET_CHARACTERS } },
            },
          })
          .json()
      );

      const results = response.results.flatMap((result): WebResult[] => {
        const parsed = resultSchema.safeParse(result);

        if (!parsed.success) return [];

        const { url, title, publishedDate, text: body } = parsed.data;

        return [
          {
            url,
            title,
            snippet: body.replace(/\s+/g, " ").trim(),
            site: site(url),
            published: published(publishedDate, market),
          },
        ];
      });

      return within(query, results);
    },

    async read(url: string) {
      const response = contentsResponseSchema.parse(
        await http
          .post("contents", { json: { urls: [url], text: true } })
          .json()
      );

      const [page] = response.results;

      if (!page) {
        const reason = response.statuses[0]?.error?.tag;

        throw new Error(
          `Exa could not read ${url}${reason ? `: ${reason}` : ""}`
        );
      }

      return { url, title: page.title ?? null, text: page.text };
    },
  };
}
