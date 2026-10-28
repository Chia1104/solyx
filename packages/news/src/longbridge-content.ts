import { orderBy, unescape } from "es-toolkit";
import * as z from "zod";

import { Market } from "@solyx/core/market";
import { NewsChannel, TimePrecision } from "@solyx/core/news";
import type { NewsItem, NewsQuery, NewsSource } from "@solyx/core/news";
import type { LongbridgeApi } from "@solyx/market-data/longbridge-api";
import { normalizeSpace } from "@solyx/utils/text";

const contentSchema = z.object({ items: z.array(z.unknown()) });

/** A story or a post as Longbridge lists it, published in UTC seconds, with how many readers liked it. */
const entrySchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  url: z.string(),
  published_at: z.string().regex(/^\d+$/),
  likes_count: z.number(),
});

type Entry = z.infer<typeof entrySchema>;

// A story Longbridge gives no title takes the start of its summary, as long as a headline runs.
const HEADLINE_LENGTH = 80;

// Longbridge marks a listing a post names as `[st]ST/US/TSLA#特斯拉.US[/st]` and a mention as
// `[at]@name[/at]`, which read as the name they show.
const MARKUP = /\[st\][^#[\]]*#([^[]*)\[\/st\]|\[at\]([^[]*)\[\/at\]/g;

const plain = (text: string) =>
  normalizeSpace(
    unescape(text).replaceAll(MARKUP, (_, listing = "", mention = "") =>
      String(listing || mention)
    )
  );

function headline({ title, description }: Entry): string {
  const own = plain(title);

  if (own) return own;

  const summary = plain(description);

  return summary.length > HEADLINE_LENGTH
    ? `${summary.slice(0, HEADLINE_LENGTH)}…`
    : summary;
}

export interface LongbridgeContentOptions {
  /** The sign-in's HTTP API, whose budget its other readers share. */
  api: LongbridgeApi;
}

/** One of Longbridge's feeds of a listing, newest first, as items of one channel. */
function feed(
  { api }: LongbridgeContentOptions,
  {
    id,
    channel,
    path,
    voted,
  }: {
    id: string;
    channel: NewsChannel;
    /** The feed under a listing, `news` or `topics`. */
    path: string;
    /** Whether readers' likes count as its votes, as a forum's do. */
    voted: boolean;
  }
): NewsSource {
  async function entries(symbol: string): Promise<Entry[]> {
    const what = `the ${path} of ${symbol}`;

    const { items } = await api.read(
      `v1/content/${symbol}.US/${path}`,
      {},
      contentSchema,
      what
    );

    const read = items.flatMap((item) => {
      const parsed = entrySchema.safeParse(item);

      return parsed.success ? [parsed.data] : [];
    });

    if (items.length > 0 && read.length === 0) {
      throw new Error(
        `Longbridge: none of the ${items.length} rows of ${what} read as expected`
      );
    }

    return read;
  }

  const item = (entry: Entry): NewsItem => ({
    id: entry.url,
    url: entry.url,
    title: headline(entry),
    snippet: plain(entry.description),
    site: "longbridge.com",
    published: {
      at: new Date(Number(entry.published_at) * 1000),
      precision: TimePrecision.Minute,
    },
    votes: voted ? entry.likes_count : null,
  });

  return {
    id,
    channel,
    markets: [Market.US],

    async search({ symbol, since, limit }: NewsQuery) {
      const found = (await entries(symbol.symbol))
        .map(item)
        .filter(
          ({ title, published }) => title && published && published.at >= since
        );

      return orderBy(
        found,
        [({ published }) => published?.at.getTime() ?? 0],
        ["desc"]
      ).slice(0, limit);
    },
  };
}

/** US listings' news as Longbridge gathers and translates it, in traditional Chinese, on the user's sign-in. */
export const createLongbridgeNews = (options: LongbridgeContentOptions) =>
  feed(options, {
    id: "longbridge-news",
    channel: NewsChannel.Article,
    path: "news",
    voted: false,
  });

/** What Longbridge's community posts about a US listing, its readers' likes as its votes, on the user's sign-in. */
export const createLongbridgeTopics = (options: LongbridgeContentOptions) =>
  feed(options, {
    id: "longbridge-topics",
    channel: NewsChannel.Forum,
    path: "topics",
    voted: true,
  });
