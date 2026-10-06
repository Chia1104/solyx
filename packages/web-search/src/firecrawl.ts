import * as z from "zod";

import { Market } from "@solyx/core/market";
import { TimePrecision } from "@solyx/core/news";
import type { Published } from "@solyx/core/news";
import { WebSearchKind } from "@solyx/core/web-search";
import type {
  WebReader,
  WebResult,
  WebSearch,
  WebSearchQuery,
} from "@solyx/core/web-search";

import { calendarDate, onDay, site, vendorHttp, within } from "./vendor.ts";

/** Firecrawl's hosted API. */
const FIRECRAWL_API_URL = "https://api.firecrawl.dev/v2/";

// Google ranks results for the searcher's country, which Firecrawl takes as a code and a place.
const MARKET_COUNTRY: Record<Market, { country: string; location: string }> = {
  [Market.TW]: { country: "TW", location: "Taiwan" },
  [Market.US]: { country: "US", location: "United States" },
};

const searchResponseSchema = z.object({
  data: z.object({
    news: z.array(z.unknown()).catch([]),
    web: z.array(z.unknown()).catch([]),
  }),
});

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

const scrapeResponseSchema = z.object({
  data: z.object({
    markdown: z.string(),
    metadata: z
      .object({ title: z.string().trim().min(1).optional().catch(undefined) })
      .catch({}),
  }),
});

const AGE_PATTERN = /^(\d+)\s+(minute|hour|day|week)s?\s+ago$/i;

// An age is as exact as its unit; weeks are rare within the days a search covers.
const AGE_UNITS = new Map([
  ["minute", { ms: 60_000, precision: TimePrecision.Minute }],
  ["hour", { ms: 3_600_000, precision: TimePrecision.Hour }],
  ["day", { ms: 86_400_000, precision: TimePrecision.Day }],
  ["week", { ms: 604_800_000, precision: TimePrecision.Day }],
]);

// Google starts a dated web result's description with its date: `22 hours ago · …`.
const DATED_DESCRIPTION = /^(.{1,40}?) · ([\s\S]*)$/;

/**
 * Reads Google's ages, such as `3 hours ago`, and dates such as `Sep 29, 2026`, which name a day
 * on the market's calendar.
 */
function published(
  date: string | undefined,
  market: Market | null,
  now: Date
): Published | null {
  if (date === undefined) return null;

  const age = AGE_PATTERN.exec(date.trim());
  const unit = age ? AGE_UNITS.get(age[2].toLowerCase()) : undefined;

  if (age && unit) {
    return {
      at: new Date(now.getTime() - Number(age[1]) * unit.ms),
      precision: unit.precision,
    };
  }

  // Parsed on this computer's clock only to read which day it names.
  const parsed = new Date(date);

  if (Number.isNaN(parsed.getTime())) return null;

  const day = [parsed.getFullYear(), parsed.getMonth() + 1, parsed.getDate()]
    .map((part) => String(part).padStart(2, "0"))
    .join("-");

  return onDay(market, day);
}

/** A calendar date as Google's date range reads it, `M/D/YYYY`. */
function rangeDate(market: Market | null, at: Date): string {
  const [year, month, day] = calendarDate(market, at).split("-");

  return `${Number(month)}/${Number(day)}/${year}`;
}

/** Google's operators for searching within hosts. */
const withinSites = (text: string, sites: readonly string[]) =>
  sites.length === 0
    ? text
    : `${text} ${sites.map((host) => `site:${host}`).join(" OR ")}`;

export interface FirecrawlOptions {
  apiKey: string;
  /** @default globalThis.fetch */
  fetch?: typeof globalThis.fetch;
  /** @default () => new Date() */
  now?: () => Date;
}

/** Google's results through Firecrawl's search, and pages through its scraper, on the user's key. */
export function createFirecrawl(
  options: FirecrawlOptions
): WebSearch & WebReader {
  const http = vendorHttp("Firecrawl", {
    baseUrl: FIRECRAWL_API_URL,
    headers: { Authorization: `Bearer ${options.apiKey}` },
    fetch: options.fetch,
  });

  const now = options.now ?? (() => new Date());

  return {
    async search(query: WebSearchQuery) {
      const { text, kind, since, sites, market, limit } = query;
      const at = now();

      const response = searchResponseSchema.parse(
        await http
          .post("search", {
            json: {
              query: withinSites(text, sites),
              sources: [kind],
              limit,
              ...(market && MARKET_COUNTRY[market]),
              // Firecrawl applies a date range to web results only; news results are filtered below.
              ...(kind === WebSearchKind.Web && {
                tbs: `cdr:1,cd_min:${rangeDate(market, since)},cd_max:${rangeDate(market, at)}`,
              }),
              // The text as published, rather than excerpts Firecrawl picks for the query.
              highlights: false,
            },
          })
          .json()
      );

      const results =
        kind === WebSearchKind.News
          ? response.data.news.flatMap((result): WebResult[] => {
              const parsed = newsResultSchema.safeParse(result);

              if (!parsed.success) return [];

              const { url, title, snippet, date } = parsed.data;

              return [
                {
                  url,
                  title,
                  snippet,
                  site: site(url),
                  published: published(date, market, at),
                },
              ];
            })
          : response.data.web.flatMap((result): WebResult[] => {
              const parsed = webResultSchema.safeParse(result);

              if (!parsed.success) return [];

              const { url, title, description } = parsed.data;
              const dated = DATED_DESCRIPTION.exec(description);
              const date = dated ? published(dated[1], market, at) : null;

              return [
                {
                  url,
                  title,
                  snippet: date && dated ? dated[2].trim() : description,
                  site: site(url),
                  published: date,
                },
              ];
            });

      return within(query, results);
    },

    async read(url: string) {
      const { data } = scrapeResponseSchema.parse(
        await http
          .post("scrape", {
            json: { url, formats: ["markdown"], onlyMainContent: true },
          })
          .json()
      );

      return {
        url,
        title: data.metadata.title ?? null,
        text: data.markdown,
      };
    },
  };
}
