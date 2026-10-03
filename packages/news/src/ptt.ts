import { unescape } from "es-toolkit";
import ky from "ky";

import { Market } from "@solyx/core/market";
import { NewsChannel } from "@solyx/core/news";
import type { NewsItem, NewsQuery, NewsSource } from "@solyx/core/news";

const PTT_URL = "https://www.ptt.cc";

// PTT's web pages have kept this markup for years. An entry without a link is a deleted post.
const ENTRY_PATTERN = /<div class="r-ent">([\s\S]*?)<div class="mark">/g;

// Post ids carry their creation time: M.<Unix seconds>.A.<hex>.
const LINK_PATTERN =
  /<a href="(\/bbs\/Stock\/M\.(\d+)\.A\.[0-9A-F]+\.html)">([^<]+)<\/a>/;

const VOTES_PATTERN =
  /<div class="nrec">(?:<span[^>]*>([^<]*)<\/span>)?<\/div>/;

/** PTT's net pushes: a number, 爆 from 100, and X1 to X9 or XX for tens of net boos. */
function votes(mark: string | undefined): number {
  if (!mark) return 0;

  if (mark === "爆") return 100;

  if (mark === "XX") return -100;

  if (mark.startsWith("X")) return -10 * (Number(mark.slice(1)) || 0);

  return Number(mark) || 0;
}

export interface PttOptions {
  /** @default globalThis.fetch */
  fetch?: typeof fetch;
}

/** Titles on PTT's Stock board, Taiwan's busiest stock forum, newest first with their net pushes. */
export function createPtt(options: PttOptions = {}): NewsSource {
  const http = ky.create({
    baseUrl: `${PTT_URL}/bbs/Stock/`,
    fetch: options.fetch,
  });

  return {
    id: "ptt-stock",
    channel: NewsChannel.Forum,
    markets: [Market.TW],

    async search({ symbol, listing, since, limit }: NewsQuery) {
      // The search matches titles, which name a company more often than its code.
      const html = await http
        .get("search", { searchParams: { q: listing?.name ?? symbol.symbol } })
        .text();

      const items: NewsItem[] = [];

      for (const [, entry] of html.matchAll(ENTRY_PATTERN)) {
        const link = LINK_PATTERN.exec(entry);

        if (!link) continue;

        const publishedAt = new Date(Number(link[2]) * 1000);

        if (publishedAt < since) continue;

        items.push({
          id: `${PTT_URL}${link[1]}`,
          url: `${PTT_URL}${link[1]}`,
          title: unescape(link[3]).trim(),
          snippet: "",
          site: "ptt.cc",
          publishedAt,
          votes: votes(VOTES_PATTERN.exec(entry)?.[1]),
        });
      }

      return items.slice(0, limit);
    },
  };
}
