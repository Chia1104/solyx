import { uniqBy } from "es-toolkit";
import ky, { isHTTPError } from "ky";
import type { KyInstance } from "ky";
import * as z from "zod";

import { exchangeDate, exchangeMidnight } from "@solyx/core/market";
import type { Market } from "@solyx/core/market";
import { TimePrecision } from "@solyx/core/news";
import type { Published } from "@solyx/core/news";
import type { WebResult, WebSearchQuery } from "@solyx/core/web-search";

// Vendors search and render pages on their side, which takes longer than ky's default allows.
const VENDOR_TIMEOUT_MS = 60_000;

// Vendors say what went wrong in `error`, some in `message`, Tavily in `detail.error`.
const failureSchema = z.union([
  z.object({ error: z.string() }).transform(({ error }) => error),
  z.object({ message: z.string() }).transform(({ message }) => message),
  z
    .object({ detail: z.object({ error: z.string() }) })
    .transform(({ detail }) => detail.error),
]);

export interface VendorOptions {
  baseUrl: string;
  headers: Record<string, string>;
  /** @default globalThis.fetch */
  fetch?: typeof globalThis.fetch;
}

/** Requests to a vendor's API, whose failures name the vendor and the reason it gives. */
export function vendorHttp(vendor: string, options: VendorOptions): KyInstance {
  return ky.create({
    ...options,
    timeout: VENDOR_TIMEOUT_MS,
    hooks: {
      beforeError: [
        ({ error }) => {
          if (!isHTTPError(error)) {
            error.message = `${vendor}: ${error.message}`;

            return error;
          }

          const reason = failureSchema.safeParse(error.data).data;

          error.message = `${vendor} answered ${error.response.status}${reason ? `: ${reason}` : ""}`;

          return error;
        },
      ],
    },
  });
}

/** A calendar date as `YYYY-MM-DD`, on the market's calendar or, without one, UTC's. */
export const calendarDate = (market: Market | null, at: Date): string =>
  market ? exchangeDate(market, at) : at.toISOString().slice(0, 10);

/** Published on a `YYYY-MM-DD` day, known only to the day: its start on the calendar `calendarDate` reads. */
export function onDay(market: Market | null, day: string): Published {
  return {
    at: new Date(
      market
        ? exchangeMidnight(market, day) * 1000
        : Date.parse(`${day}T00:00:00Z`)
    ),
    precision: TimePrecision.Day,
  };
}

export const site = (url: string) =>
  new URL(url).hostname.replace(/^www\./, "");

/** Each address once, up to the limit, without results known to be published before the first day. */
export function within(
  query: WebSearchQuery,
  results: readonly WebResult[]
): WebResult[] {
  const first = calendarDate(query.market, query.since);

  return uniqBy(results, (result) => result.url)
    .filter(
      ({ published }) =>
        published === null || calendarDate(query.market, published.at) >= first
    )
    .slice(0, query.limit);
}
