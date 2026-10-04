import { expect, test } from "vite-plus/test";

import { Market } from "../src/market.ts";
import {
  NewsChannel,
  NewsVoice,
  TimePrecision,
  dailySentiment,
  newsStories,
  sentimentGauge,
} from "../src/news.ts";
import type { NewsItem, NewsRecord } from "../src/news.ts";
import { Stance, TextKind, TextTopic } from "../src/sentiment.ts";
import type { SentimentScore } from "../src/sentiment.ts";

const NOW = new Date("2026-10-03T05:00:00Z");

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
