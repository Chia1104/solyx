import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";

import type { Embedder } from "@solyx/core/embedding";
import { Market } from "@solyx/core/market";
import type { SymbolRef } from "@solyx/core/market";
import type { MarketData } from "@solyx/core/market-data";
import { NewsChannel, TimePrecision } from "@solyx/core/news";
import type { NewsItem, NewsSource } from "@solyx/core/news";
import {
  Stance,
  TextKind,
  TextSpeaker,
  TextTopic,
} from "@solyx/core/sentiment";
import type { SentimentScore, SentimentScorer } from "@solyx/core/sentiment";
import { openNews } from "@solyx/db/news";
import type { NewsData } from "@solyx/db/news";

import { createNews } from "../src/main/modules/news/news.ts";

const MIGRATIONS = fileURLToPath(
  new URL("../../../packages/db/migrations/news", import.meta.url)
);

const TSMC = { market: Market.TW, symbol: "2330" };

const FOXCONN = { market: Market.TW, symbol: "2317" };

const MEDIATEK = { market: Market.TW, symbol: "2454" };

const APPLE = { market: Market.US, symbol: "AAPL" };

const NOW = new Date("2026-10-03T05:00:00Z");

const SINCE = new Date("2026-09-26T00:00:00Z");

const HOUR_MS = 60 * 60 * 1000;

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
  speaker: {
    [TextSpeaker.Company]: 0,
    [TextSpeaker.Outlet]: 0.9,
    [TextSpeaker.Investor]: 0.1,
    [TextSpeaker.Reference]: 0,
    [TextSpeaker.Other]: 0,
  },
};

let directory: string;

let data: NewsData;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "solyx-news-"));
  data = openNews(join(directory, "news.sqlite"), MIGRATIONS);
});

afterEach(async () => {
  data.close();
  await rm(directory, { recursive: true, force: true });
});

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

function source(
  id: string,
  channel: NewsChannel,
  search: NewsSource["search"],
  markets: Market[] = [Market.TW]
) {
  return { id, channel, markets, search: vi.fn(search) };
}

const scorer = () => ({
  score: vi.fn<SentimentScorer["score"]>(async () => SCORE),
});

function setup(
  sources: NewsSource[],
  decisions: SentimentScorer | undefined = undefined,
  embedder: Embedder | undefined = undefined
) {
  const clock = { now: NOW };
  const onChange = vi.fn<(symbol: SymbolRef) => void>();
  const listing = vi.fn<MarketData["listing"]>(async () => null);

  const news = createNews({
    sources: async () => sources,
    store: data.store,
    scorer: async () => decisions,
    embedder: async () => embedder,
    marketData: { listing },
    onChange,
    now: () => clock.now,
  });

  return { news, clock, onChange, listing };
}

test("a collection stores what each source finds and scores each channel's newest unscored stories once", async () => {
  data.store.save(
    TSMC,
    { id: "news", channel: NewsChannel.Article },
    [item("scored before", 30)],
    NOW
  );
  data.store.saveScore(TSMC, data.store.list(TSMC, SINCE)[0], SCORE);

  const decisions = scorer();

  const { news } = setup(
    [
      source("news", NewsChannel.Article, async () => [
        item("scored before", 30),
        item("new", 29),
        item("older", 28),
      ]),
      source("forum", NewsChannel.Forum, async () => [item("post", 27)]),
    ],
    decisions
  );

  const collection = await news.collect(TSMC, SINCE, 2);

  expect(data.store.list(TSMC, SINCE).map((record) => record.item.id)).toEqual([
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
  expect(decisions.score.mock.calls.map(([input]) => input.title)).toEqual([
    "new",
    "post",
  ]);
  expect(collection).toMatchObject({ failures: [], scored: true });
});

test("reprints are one story, judged once, and a story found again is not judged again", async () => {
  const decisions = scorer();

  const reprint = (site: string, day: number) => ({
    ...item(`${site}/reprint`, day),
    title: "台積電法說會上修全年營收展望",
    site,
  });

  const articles = source("news", NewsChannel.Article, async () => [
    reprint("money.udn.com", 29),
    reprint("tw.stock.yahoo.com", 30),
  ]);

  const { news } = setup([articles], decisions);

  const first = await news.collect(TSMC, SINCE, 10);

  articles.search.mockResolvedValue([]);

  const again = await news.collect(TSMC, SINCE, 10);

  expect(decisions.score).toHaveBeenCalledOnce();
  expect(first.stories).toHaveLength(1);
  expect(first.stories[0].lead).toMatchObject({
    item: { site: "money.udn.com" },
    score: SCORE,
  });
  expect(first.stories[0].records).toHaveLength(2);
  expect(again.stories).toEqual(first.stories);
});

test("a failed source is reported with how its searches have gone, and what it stored before stays", async () => {
  data.store.save(
    TSMC,
    { id: "social", channel: NewsChannel.Social },
    [item("earlier post", 30)],
    NOW
  );

  const { news } = setup([
    source("news", NewsChannel.Article, async () => []),
    source("social", NewsChannel.Social, async () => {
      throw new Error("Firecrawl returned 402");
    }),
  ]);

  const collection = await news.collect(TSMC, SINCE, 10);

  const failed = {
    source: "social",
    lastSuccessAt: null,
    lastFailureAt: NOW,
    failureStreak: 1,
    lastError: "Firecrawl returned 402",
  };

  expect(collection.failures).toEqual([failed]);
  expect(collection.stories.map(({ lead }) => lead.item.id)).toEqual([
    "earlier post",
  ]);
  expect(await news.coverage(TSMC)).toEqual({
    collectedAt: NOW,
    sources: [
      {
        id: "news",
        channel: NewsChannel.Article,
        health: {
          source: "news",
          lastSuccessAt: NOW,
          lastFailureAt: null,
          failureStreak: 0,
          lastError: null,
        },
      },
      { id: "social", channel: NewsChannel.Social, health: failed },
    ],
  });
});

test("without a decisions model nothing is scored", async () => {
  const { news } = setup([
    source("news", NewsChannel.Article, async () => [item("new", 29)]),
  ]);

  const collection = await news.collect(TSMC, SINCE, 10);

  expect(collection.scored).toBe(false);
  expect(collection.stories.map(({ lead }) => lead.score)).toEqual([null]);
});

test("the listing's names sharpen the searches, and a failed lookup leaves them out", async () => {
  const articles = source("news", NewsChannel.Article, async () => []);
  const { news, listing } = setup([articles]);
  const names = { name: "台積電", englishName: "TSMC" };

  listing.mockResolvedValueOnce(names);
  await news.collect(TSMC, SINCE, 10);
  listing.mockRejectedValueOnce(new Error("offline"));
  await news.collect(TSMC, SINCE, 10);

  expect(articles.search.mock.calls.map(([query]) => query.listing)).toEqual([
    names,
    null,
  ]);
});

test("a market no source covers is reported, not guessed", async () => {
  const { news } = setup([source("news", NewsChannel.Article, async () => [])]);

  await expect(news.collect(APPLE, SINCE, 10)).rejects.toThrow(
    "No news source covers US"
  );
});

test("each collection is told once, even one that fails partway", async () => {
  const { news, onChange } = setup(
    [source("news", NewsChannel.Article, async () => [item("new", 29)])],
    {
      score: async () => {
        throw new Error("decisions model down");
      },
    }
  );

  await expect(news.collect(TSMC, SINCE, 10)).rejects.toThrow(
    "decisions model down"
  );
  expect(onChange).toHaveBeenCalledOnce();
  expect(onChange).toHaveBeenCalledWith(TSMC);
  // Stored before scoring failed, so the next collection scores it.
  expect(data.store.list(TSMC, SINCE)[0].score).toBeNull();
});

test("a listing is refreshed once per interval, first a week back, then overlapping the last by a day", async () => {
  const forum = source("forum", NewsChannel.Forum, async () => []);
  const { news, clock } = setup([forum]);
  const every = 72 * HOUR_MS;

  await news.refresh(TSMC, every);
  await news.refresh(TSMC, every);
  await news.refresh(APPLE, every);

  // No source covers the US, so Apple is neither searched nor marked.
  expect(forum.search).toHaveBeenCalledOnce();
  expect(forum.search.mock.calls[0][0]).toMatchObject({
    symbol: TSMC,
    since: new Date("2026-09-26T05:00:00Z"),
  });
  expect((await news.coverage(APPLE)).collectedAt).toBeNull();

  // A day short of the interval.
  clock.now = new Date("2026-10-05T05:00:00Z");
  await news.refresh(TSMC, every);

  expect(forum.search).toHaveBeenCalledOnce();

  clock.now = new Date("2026-10-06T05:00:00Z");
  await news.refresh(TSMC, every);

  expect(forum.search).toHaveBeenCalledTimes(2);
  expect(forum.search.mock.calls[1][0]).toMatchObject({
    since: new Date("2026-10-02T05:00:00Z"),
  });
});

test("a source that keeps failing rests from refreshes, and a listing only it covers waits for it", async () => {
  const broken = source(
    "broken",
    NewsChannel.Social,
    async () => {
      throw new Error("Firecrawl returned 402");
    },
    [Market.TW, Market.US]
  );

  const working = source("forum", NewsChannel.Forum, async () => []);
  const { news, clock } = setup([broken, working]);
  const every = 72 * HOUR_MS;

  for (const symbol of [TSMC, FOXCONN, MEDIATEK, APPLE]) {
    await news.refresh(symbol, every);
  }

  // Rests after its third failure in a row, while the forum still covers Taiwan.
  expect(broken.search).toHaveBeenCalledTimes(3);
  expect(working.search).toHaveBeenCalledTimes(3);
  expect((await news.coverage(APPLE)).collectedAt).toBeNull();

  clock.now = new Date("2026-10-03T11:00:00Z");
  await news.refresh(APPLE, every);

  expect(broken.search).toHaveBeenCalledTimes(4);
  expect((await news.coverage(APPLE)).collectedAt).toEqual(clock.now);
});

test("collecting on request searches a resting source too", async () => {
  const broken = source("broken", NewsChannel.Social, async () => {
    throw new Error("Firecrawl returned 402");
  });

  const { news } = setup([broken]);

  for (const symbol of [TSMC, FOXCONN, MEDIATEK]) {
    await news.refresh(symbol, HOUR_MS);
  }

  await news.collect(TSMC, SINCE, 10);

  expect(broken.search).toHaveBeenCalledTimes(4);
});

test("headlines rank what is stored about the listings asked for, heaviest first", async () => {
  const { news } = setup([]);
  const filings = { id: "filings", channel: NewsChannel.Announcement };
  const forum = { id: "forum", channel: NewsChannel.Forum };

  data.store.save(TSMC, forum, [item("tsmc post", 30)], NOW);
  data.store.save(FOXCONN, filings, [item("foxconn filing", 30)], NOW);
  data.store.save(MEDIATEK, filings, [item("mediatek filing", 30)], NOW);

  expect(
    (await news.headlines([TSMC, FOXCONN], SINCE, 5)).map(
      ({ story, symbols }) => [story.lead.item.id, symbols]
    )
  ).toEqual([
    ["foxconn filing", [FOXCONN]],
    ["tsmc post", [TSMC]],
  ]);
  expect(await news.headlines([TSMC, FOXCONN], SINCE, 1)).toHaveLength(1);
});

test("once a listing's names are known, outlets rewording one headline are one story in a collection and in the headlines", async () => {
  const reworded = (id: string, title: string, site: string) => ({
    ...item(id, 30),
    title,
    site,
  });

  const articles = source("news", NewsChannel.Article, async () => [
    reworded("first", "台積電十月營收創新高 年增四成", "a.test"),
    reworded("second", "快訊／台積電10月營收再創新高，年增逾四成", "b.test"),
  ]);

  const { news, listing } = setup([articles]);

  listing.mockResolvedValue({ name: "台積電", englishName: "TSMC" });

  const collection = await news.collect(TSMC, SINCE, 10);

  expect(collection.stories).toHaveLength(1);
  expect(collection.gauge.overall.stories).toBe(1);
  expect(collection.stories[0].records).toHaveLength(2);
  expect(await news.headlines([TSMC], SINCE, 5)).toHaveLength(1);
});

/** Vectors on a measured space, alike for every title the map names alike and apart otherwise. */
function embedderOf(alike: Record<string, number>) {
  return {
    space: "qwen3-embedding:0.6b",
    embed: vi.fn<Embedder["embed"]>(async (texts) =>
      texts.map((text) => {
        const angle =
          ((alike[text] ?? texts.indexOf(text) * 10 + 45) * Math.PI) / 180;

        return Float32Array.of(Math.cos(angle), Math.sin(angle));
      })
    ),
  };
}

test("outlets wording one event too differently for their titles are one story once their vectors read alike", async () => {
  const told = (id: string, title: string, site: string) => ({
    ...item(id, 30),
    title,
    site,
  });

  const articles = source("news", NewsChannel.Article, async () => [
    told("first", "鴻海9月營收創同期新高 年增逾兩成", "a.test"),
    told("second", "雲端產品撐腰 鴻海上月營收寫同期最佳", "b.test"),
  ]);

  const embedder = embedderOf({
    "鴻海9月營收創同期新高 年增逾兩成": 0,
    "雲端產品撐腰 鴻海上月營收寫同期最佳": 5,
  });

  const { news } = setup([articles], undefined, embedder);
  const collection = await news.collect(FOXCONN, SINCE, 10);

  expect(collection.stories).toHaveLength(1);
  expect(embedder.embed).toHaveBeenCalledOnce();

  const reading = await news.reading(FOXCONN, SINCE);

  expect(reading.stories).toHaveLength(1);
  // Vectors stay in the main process, and nothing kept is embedded again.
  expect(reading.stories[0].records.every((record) => !record.embedding)).toBe(
    true
  );
  expect(
    (await news.headlines([FOXCONN], SINCE, 5))[0].story.lead
  ).not.toHaveProperty("embedding");
  expect(embedder.embed).toHaveBeenCalledOnce();
});

test("news groups by titles alone while the embedder cannot be reached", async () => {
  const articles = source("news", NewsChannel.Article, async () => [
    {
      ...item("first", 30),
      title: "鴻海9月營收創同期新高 年增逾兩成",
      site: "a.test",
    },
    {
      ...item("second", 30),
      title: "雲端產品撐腰 鴻海上月營收寫同期最佳",
      site: "b.test",
    },
  ]);

  const embedder = {
    space: "qwen3-embedding:0.6b",
    embed: vi.fn<Embedder["embed"]>(async () => {
      throw new Error("127.0.0.1:11434: fetch failed");
    }),
  };

  const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
  const { news } = setup([articles], undefined, embedder);

  expect((await news.collect(FOXCONN, SINCE, 10)).stories).toHaveLength(2);
  expect(error).toHaveBeenCalledWith(
    "Embedding news failed: 127.0.0.1:11434: fetch failed"
  );

  error.mockRestore();
});
