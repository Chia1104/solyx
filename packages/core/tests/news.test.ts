import { orderBy } from "es-toolkit";
import { expect, test, vi } from "vite-plus/test";

import { Market } from "../src/market.ts";
import {
  NewsChannel,
  NewsVoice,
  TimePrecision,
  collectNews,
  dailySentiment,
  newsStories,
  sentimentGauge,
} from "../src/news.ts";
import type {
  NewsItem,
  NewsRecord,
  NewsSource,
  NewsStore,
  SourceHealth,
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
    published: {
      at: new Date(Date.UTC(2026, 8, day)),
      precision: TimePrecision.Minute,
    },
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
  const health = new Map<string, SourceHealth>();
  let collected: Date | null = null;

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
    lastCollected: () => collected,
    markCollected(_symbol, at) {
      collected = at;
    },
    markSearched(source, at, error) {
      const before = health.get(source);

      health.set(
        source,
        error === null
          ? {
              source,
              lastSuccessAt: at,
              lastFailureAt: before?.lastFailureAt ?? null,
              failureStreak: 0,
              lastError: before?.lastError ?? null,
            }
          : {
              source,
              lastSuccessAt: before?.lastSuccessAt ?? null,
              lastFailureAt: at,
              failureStreak: (before?.failureStreak ?? 0) + 1,
              lastError: error,
            }
      );
    },
    sourceHealth: () => [...health.values()],
    list: (_symbol, since) =>
      orderBy(
        records.filter(
          (record) => (record.item.published?.at ?? record.foundAt) >= since
        ),
        [(record) => (record.item.published?.at ?? record.foundAt).getTime()],
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

test("stores what each source finds and scores each channel's newest unscored stories once", async () => {
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
    collection.stories.map(({ lead }) => [lead.item.id, lead.score])
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
  expect(collection.stories.map(({ lead }) => lead.item.id)).toEqual([
    "earlier post",
  ]);
});

test("each search's outcome is recorded against its source", async () => {
  const { store } = memoryStore();

  await collectNews({
    sources: [
      source("news", NewsChannel.Article, async () => []),
      source("social", NewsChannel.Social, async () => {
        throw new Error("Firecrawl returned 402");
      }),
    ],
    store,
    scorer: undefined,
    query: QUERY,
    now: NOW,
    concurrency: 2,
  });

  expect(store.sourceHealth()).toEqual([
    {
      source: "news",
      lastSuccessAt: NOW,
      lastFailureAt: null,
      failureStreak: 0,
      lastError: null,
    },
    {
      source: "social",
      lastSuccessAt: null,
      lastFailureAt: NOW,
      failureStreak: 1,
      lastError: "Firecrawl returned 402",
    },
  ]);
});

test("collecting marks the listing collected, even when a source fails", async () => {
  const { store } = memoryStore();

  await collectNews({
    sources: [
      source("social", NewsChannel.Social, async () => {
        throw new Error("down");
      }),
    ],
    store,
    scorer: undefined,
    query: QUERY,
    now: NOW,
    concurrency: 2,
  });

  expect(store.lastCollected(TSMC)).toEqual(NOW);
});

function record(
  hour: string,
  score: SentimentScore | null,
  publishedAt: string | null = hour
): NewsRecord {
  return {
    source: "news",
    channel: NewsChannel.Article,
    item: {
      ...item(hour, 1),
      published:
        publishedAt === null
          ? null
          : { at: new Date(publishedAt), precision: TimePrecision.Minute },
    },
    foundAt: new Date("2026-10-03T01:00:00Z"),
    score,
  };
}

function scored(relevance: number, positive: number, promotion = 0) {
  return {
    ...SCORE,
    relevance,
    stance: {
      ...SCORE.stance,
      [Stance.Neutral]: 1 - positive,
      [Stance.Positive]: positive,
    },
    kind: {
      [TextKind.Report]: 1 - promotion,
      [TextKind.Opinion]: 0,
      [TextKind.Promotion]: promotion,
    },
  };
}

test("each day's stance weighs items by relevance and leaves promotions out", () => {
  const days = dailySentiment(Market.TW, [
    // 2026-10-02 in Taipei
    record("2026-10-02T02:00:00Z", scored(1, 1)),
    record("2026-10-02T03:00:00Z", scored(0.5, 0)),
    record("2026-10-02T04:00:00Z", scored(1, 1, 1)),
    // Only names the listing in passing, so it neither counts nor weighs.
    record("2026-10-02T05:00:00Z", scored(0.2, 1)),
    record("2026-10-02T06:00:00Z", null),
    // 2026-10-01 in Taipei, 23:30 the day before in UTC
    record("2026-09-30T16:30:00Z", null),
    // Undated, so it counts on the day it was found: 2026-10-03 in Taipei.
    record("undated", null, null),
  ]);

  expect(days).toEqual([
    { date: "2026-10-01", stance: null, weight: 0, stories: 1 },
    { date: "2026-10-02", stance: 2 / 3, weight: 1.5, stories: 4 },
    { date: "2026-10-03", stance: null, weight: 0, stories: 1 },
  ]);
});

test("the gauge reads 0 to 100 overall and for the press and the crowd apart", () => {
  const forum = (hour: string, score: SentimentScore | null): NewsRecord => ({
    ...record(hour, score),
    source: "ptt",
    channel: NewsChannel.Forum,
  });

  expect(
    sentimentGauge([
      record("2026-10-02T02:00:00Z", scored(1, 1)),
      record("2026-10-02T03:00:00Z", scored(0.2, 0)),
      forum("2026-10-02T04:00:00Z", scored(1, 0)),
      forum("2026-10-02T05:00:00Z", null),
    ])
  ).toEqual({
    overall: { score: 75, stories: 3 },
    voices: {
      [NewsVoice.Press]: { score: 100, stories: 1 },
      [NewsVoice.Crowd]: { score: 50, stories: 2 },
    },
  });

  expect(sentimentGauge([])).toEqual({
    overall: { score: null, stories: 0 },
    voices: {
      [NewsVoice.Press]: { score: null, stories: 0 },
      [NewsVoice.Crowd]: { score: null, stories: 0 },
    },
  });
});

function told(
  title: string,
  publishedAt: string,
  {
    channel = NewsChannel.Article,
    site = "news.test",
    score = null,
  }: {
    channel?: NewsChannel;
    site?: string;
    score?: SentimentScore | null;
  } = {}
): NewsRecord {
  return {
    source: channel,
    channel,
    item: {
      id: `${site}/${title}/${publishedAt}`,
      url: null,
      title,
      snippet: "",
      site,
      published: { at: new Date(publishedAt), precision: TimePrecision.Minute },
      votes: null,
    },
    foundAt: NOW,
    score,
  };
}

const storyTitles = (records: NewsRecord[]) =>
  newsStories(records).map((story) =>
    story.records.map(({ item }) => `${item.site} ${item.title}`)
  );

test("reprints and replies are one story, newest story first", () => {
  expect(
    storyTitles([
      told("台積電法說會：上修全年營收展望", "2026-10-02T02:00:00Z", {
        site: "money.udn.com",
      }),
      told("台積電法說會 上修全年營收展望", "2026-10-02T03:00:00Z", {
        site: "tw.stock.yahoo.com",
      }),
      told("[新聞] 台積電擬赴美設第二園區", "2026-10-01T02:00:00Z", {
        channel: NewsChannel.Forum,
        site: "ptt.cc",
      }),
      told("Re: [新聞] 台積電擬赴美設第二園區", "2026-10-01T05:00:00Z", {
        channel: NewsChannel.Forum,
        site: "ptt.cc",
      }),
    ])
  ).toEqual([
    [
      "money.udn.com 台積電法說會：上修全年營收展望",
      "tw.stock.yahoo.com 台積電法說會 上修全年營收展望",
    ],
    [
      "ptt.cc [新聞] 台積電擬赴美設第二園區",
      "ptt.cc Re: [新聞] 台積電擬赴美設第二園區",
    ],
  ]);
});

test("titles that differ, are short, lie days apart or sit in other channels stay apart", () => {
  expect(
    newsStories([
      // One word apart, and saying the opposite.
      told("外資調升台積電目標價至1500元", "2026-10-02T02:00:00Z"),
      told("外資調降台積電目標價至1500元", "2026-10-02T03:00:00Z"),
      // Too short to tell two posts apart.
      told("台積電", "2026-10-02T02:00:00Z", { channel: NewsChannel.Social }),
      told("台積電", "2026-10-02T03:00:00Z", { channel: NewsChannel.Social }),
      // A column that runs under one title every week.
      told("本週法人買賣超排行", "2026-09-22T02:00:00Z"),
      told("本週法人買賣超排行", "2026-09-29T02:00:00Z"),
      // The same words in two voices are told apart.
      told("台積電擬赴美設第二園區", "2026-10-01T02:00:00Z"),
      told("台積電擬赴美設第二園區", "2026-10-01T03:00:00Z", {
        channel: NewsChannel.Forum,
      }),
    ])
  ).toHaveLength(8);
});

test("a story is led by its earliest scored record and weighed once", () => {
  const stories = newsStories([
    told("台積電法說會上修全年營收展望", "2026-10-02T02:00:00Z"),
    told("台積電法說會上修全年營收展望", "2026-10-02T03:00:00Z", {
      score: scored(1, 1),
    }),
    told("台積電法說會上修全年營收展望", "2026-10-02T04:00:00Z", {
      score: scored(1, 0),
    }),
  ]);

  expect(stories).toHaveLength(1);
  expect(stories[0].lead.item.published?.at).toEqual(
    new Date("2026-10-02T03:00:00Z")
  );

  expect(
    sentimentGauge([
      ...stories[0].records,
      told("台積電擴大資本支出", "2026-10-02T05:00:00Z", {
        score: scored(1, 0),
      }),
    ]).overall
  ).toEqual({ score: 75, stories: 2 });
});

test("collecting scores one record of each story", async () => {
  const { store } = memoryStore();
  const scorer = { score: vi.fn<SentimentScorer["score"]>(async () => SCORE) };

  const reprint = (site: string, day: number) => ({
    ...item(`${site}/reprint`, day),
    title: "台積電法說會上修全年營收展望",
    site,
  });

  const collection = await collectNews({
    sources: [
      source("news", NewsChannel.Article, async () => [
        reprint("money.udn.com", 29),
        reprint("tw.stock.yahoo.com", 30),
      ]),
    ],
    store,
    scorer,
    query: QUERY,
    now: NOW,
    concurrency: 2,
  });

  expect(scorer.score).toHaveBeenCalledOnce();
  expect(collection.stories).toHaveLength(1);
  expect(collection.stories[0].lead).toMatchObject({
    item: { site: "money.udn.com" },
    score: SCORE,
  });
  expect(collection.stories[0].records).toHaveLength(2);
});
