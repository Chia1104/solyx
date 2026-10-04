import { orderBy } from "es-toolkit";
import { expect, test, vi } from "vite-plus/test";

import { Market } from "../src/market.ts";
import { NewsChannel, collectNews } from "../src/news.ts";
import type {
  NewsItem,
  NewsRecord,
  NewsSource,
  NewsStore,
} from "../src/news.ts";
import { Stance, TextKind, TextTopic } from "../src/sentiment.ts";
import type { SentimentScore, SentimentScorer } from "../src/sentiment.ts";

const TSMC = { market: Market.TW, symbol: "2330" };

const NOW = new Date("2026-10-03T05:00:00Z");

const QUERY = {
  symbol: TSMC,
  listing: null,
  since: new Date("2026-09-26T00:00:00Z"),
  limit: 2,
};

function item(id: string, day: number): NewsItem {
  return {
    id,
    url: `https://news.test/${id}`,
    title: id,
    snippet: "",
    site: "news.test",
    publishedAt: new Date(Date.UTC(2026, 8, day)),
    votes: null,
  };
}

const SCORE: SentimentScore = {
  model: "jev-1.13.0",
  relevance: 0.9,
  stance: {
    [Stance.Negative]: 0,
    [Stance.LeanNegative]: 0,
    [Stance.Neutral]: 1,
    [Stance.LeanPositive]: 0,
    [Stance.Positive]: 0,
  },
  kind: {
    [TextKind.Report]: 1,
    [TextKind.Opinion]: 0,
    [TextKind.Promotion]: 0,
  },
  topic: {
    [TextTopic.Earnings]: 0,
    [TextTopic.Guidance]: 0,
    [TextTopic.Business]: 1,
    [TextTopic.Capital]: 0,
    [TextTopic.Analyst]: 0,
    [TextTopic.Legal]: 0,
    [TextTopic.Market]: 0,
    [TextTopic.Other]: 0,
  },
};

/** Keeps records in memory for one listing, as the database does. */
function memoryStore(initial: NewsRecord[] = []) {
  const records = [...initial];

  const store: NewsStore = {
    save(_symbol, source, items, foundAt) {
      for (const found of items) {
        if (
          !records.some(
            (record) =>
              record.source === source.id && record.item.id === found.id
          )
        ) {
          records.push({
            source: source.id,
            channel: source.channel,
            item: found,
            foundAt,
            score: null,
          });
        }
      }
    },
    saveScore(_symbol, scored, score) {
      const record = records.find(
        (candidate) =>
          candidate.source === scored.source &&
          candidate.item.id === scored.item.id
      );

      if (record) record.score = score;
    },
    list: (_symbol, since) =>
      orderBy(
        records.filter(
          (record) => (record.item.publishedAt ?? record.foundAt) >= since
        ),
        [(record) => (record.item.publishedAt ?? record.foundAt).getTime()],
        ["desc"]
      ),
  };

  return { store, records };
}

function source(
  id: string,
  channel: NewsChannel,
  search: NewsSource["search"]
): NewsSource {
  return { id, channel, markets: [Market.TW], search };
}

test("stores what each source finds and scores each channel's newest unscored records once", async () => {
  const { store, records } = memoryStore([
    {
      source: "news",
      channel: NewsChannel.Article,
      item: item("scored before", 30),
      foundAt: NOW,
      score: SCORE,
    },
  ]);

  const scorer = { score: vi.fn<SentimentScorer["score"]>(async () => SCORE) };

  const collection = await collectNews({
    sources: [
      source("news", NewsChannel.Article, async () => [
        item("scored before", 30),
        item("new", 29),
        item("older", 28),
      ]),
      source("forum", NewsChannel.Forum, async () => [item("post", 27)]),
    ],
    store,
    scorer,
    query: QUERY,
    now: NOW,
    concurrency: 2,
  });

  expect(records.map((record) => record.item.id)).toEqual([
    "scored before",
    "new",
    "older",
    "post",
  ]);
  expect(
    collection.records.map((record) => [record.item.id, record.score])
  ).toEqual([
    ["scored before", SCORE],
    ["new", SCORE],
    ["post", SCORE],
  ]);
  expect(scorer.score.mock.calls.map(([input]) => input.title)).toEqual([
    "new",
    "post",
  ]);
  expect(collection.failures).toEqual([]);
});

test("a failed source is reported and what it stored before is kept", async () => {
  const { store } = memoryStore([
    {
      source: "social",
      channel: NewsChannel.Social,
      item: item("earlier post", 30),
      foundAt: NOW,
      score: null,
    },
  ]);

  const error = new Error("Firecrawl returned 402");

  const collection = await collectNews({
    sources: [
      source("social", NewsChannel.Social, async () => {
        throw error;
      }),
    ],
    store,
    scorer: undefined,
    query: QUERY,
    now: NOW,
    concurrency: 2,
  });

  expect(collection.failures).toEqual([{ source: "social", error }]);
  expect(collection.records.map((record) => record.item.id)).toEqual([
    "earlier post",
  ]);
});
