import { compact } from "es-toolkit";

import { Market, exchangeDate } from "@solyx/core/market";
import { NewsChannel, TimePrecision } from "@solyx/core/news";
import type {
  NewsItem,
  NewsQuery,
  NewsSource,
  Published,
} from "@solyx/core/news";
import { WebSearchKind } from "@solyx/core/web-search";
import type {
  WebResult,
  WebSearch,
  WebSearchQuery,
} from "@solyx/core/web-search";

// Threads post codes spell Instagram's media ids in URL-safe base64.
const THREADS_CODE = /^\/@[^/]+\/post\/([\w-]+)/;

const BASE64_URL =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

// Instagram's ids hold the milliseconds since this epoch above 23 bits of shard and sequence.
const INSTAGRAM_EPOCH_MS = 1_314_220_021_721n;

const X_STATUS = /^\/[^/]+\/status\/(\d+)/;

// X's Snowflake ids hold the milliseconds since this epoch above 22 bits of worker and sequence.
const X_EPOCH_MS = 1_288_834_974_657n;

interface SocialNetwork {
  site: string;
  /** Its posts' addresses, whose first group is the post's id. */
  post: RegExp;
  /** Milliseconds since the Unix epoch at which the post with this id was made. */
  postedAt(id: string): number;
  /** No post is older; an id that reads earlier is not one this reading understands. */
  launched: number;
}

// Taiwan's investors talk on Threads more than on X; US investors tag tickers on X.
const SOCIAL_NETWORK: Record<Market, SocialNetwork> = {
  [Market.TW]: {
    site: "threads.com",
    post: THREADS_CODE,
    postedAt: (code) =>
      Number(
        ([...code].reduce(
          (id, digit) => id * 64n + BigInt(BASE64_URL.indexOf(digit)),
          0n
        ) >>
          23n) +
          INSTAGRAM_EPOCH_MS
      ),
    launched: Date.UTC(2023, 6, 5),
  },
  [Market.US]: {
    site: "x.com",
    post: X_STATUS,
    postedAt: (id) => Number((BigInt(id) >> 22n) + X_EPOCH_MS),
    launched: Number(X_EPOCH_MS),
  },
};

const item = ({
  url,
  title,
  snippet,
  site,
  published,
}: WebResult): NewsItem => ({
  id: url,
  url,
  title,
  snippet,
  site,
  published,
  votes: null,
});

const searchFor = (
  { symbol, since, limit }: NewsQuery,
  query: Pick<WebSearchQuery, "text" | "kind" | "sites">
): WebSearchQuery => ({ ...query, since, limit, market: symbol.market });

/**
 * When a post was made, read from its id to the minute: a search engine dates few posts, and only
 * by its estimate. `null` for an id that reads outside the network's lifetime, should its format
 * ever change.
 */
function posted(network: SocialNetwork, id: string): Published | null {
  const at = network.postedAt(id);

  if (at < network.launched || at > Date.now()) return null;

  return { at: new Date(at), precision: TimePrecision.Minute };
}

/** News outlets' articles about the listing, through whichever web search the user set up. */
export function createWebNews(web: WebSearch): NewsSource {
  return {
    id: "web-article",
    channel: NewsChannel.Article,
    markets: Object.values(Market),

    async search(query: NewsQuery) {
      const results = await web.search(
        searchFor(query, {
          text: compact([query.listing?.name, query.symbol.symbol]).join(" "),
          kind: WebSearchKind.News,
          sites: [],
        })
      );

      return results.map(item);
    },
  };
}

/**
 * Posts on Threads in Taiwan and on X in the US, as a search engine indexed them: a sample that
 * leans to popular accounts and lags by hours, not every post. Pages that are not posts, such as
 * profiles, are left out, and each post is dated by its id.
 */
export function createWebSocial(web: WebSearch): NewsSource {
  return {
    id: "web-social",
    channel: NewsChannel.Social,
    markets: Object.values(Market),

    async search(query: NewsQuery) {
      const { symbol, listing, since } = query;
      const network = SOCIAL_NETWORK[symbol.market];
      const first = exchangeDate(symbol.market, since);

      const results = await web.search(
        searchFor(query, {
          text:
            symbol.market === Market.US
              ? `$${symbol.symbol}`
              : (listing?.name ?? symbol.symbol),
          kind: WebSearchKind.Web,
          sites: [network.site],
        })
      );

      return results.flatMap((result): NewsItem[] => {
        const id = network.post.exec(new URL(result.url).pathname)?.[1];

        if (result.site !== network.site || id === undefined) return [];

        const published = posted(network, id) ?? result.published;

        if (published && exchangeDate(symbol.market, published.at) < first) {
          return [];
        }

        return [item({ ...result, published })];
      });
    },
  };
}
