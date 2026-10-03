import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { noop } from "es-toolkit";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";

import { Market } from "@solyx/core/market";
import { NewsChannel, TimePrecision } from "@solyx/core/news";
import type { NewsSource } from "@solyx/core/news";
import { openNews } from "@solyx/db/news";
import type { NewsData } from "@solyx/db/news";

import { createNewsCollector } from "../src/main/modules/news/news-collector.ts";

const MIGRATIONS = fileURLToPath(
  new URL("../../../packages/db/migrations/news", import.meta.url)
);

const TSMC = { market: Market.TW, symbol: "2330" };

const FOXCONN = { market: Market.TW, symbol: "2317" };

const APPLE = { market: Market.US, symbol: "AAPL" };

let directory: string;

let news: NewsData;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "solyx-collector-"));
  news = openNews(join(directory, "news.sqlite"), MIGRATIONS);
});

afterEach(async () => {
  news.close();
  vi.restoreAllMocks();
  await rm(directory, { recursive: true, force: true });
});

function forum(search: NewsSource["search"]) {
  return {
    id: "forum",
    channel: NewsChannel.Forum,
    markets: [Market.TW],
    search: vi.fn(search),
  };
}

test("each watched listing is collected once per interval", async () => {
  let now = new Date("2026-10-03T05:00:00Z");

  const source = forum(async () => []);

  const collector = createNewsCollector({
    sources: async () => [source],
    store: news.store,
    scorer: async () => undefined,
    marketData: async () => undefined,
    watchlist: () => [TSMC, APPLE],
    collectEveryHours: () => 72,
    now: () => now,
  });

  await collector.check();
  await collector.check();

  // No source covers the US, so Apple is neither searched nor marked.
  expect(source.search).toHaveBeenCalledOnce();
  expect(source.search.mock.calls[0][0]).toMatchObject({
    symbol: TSMC,
    since: new Date("2026-09-26T05:00:00Z"),
  });
  expect(news.store.lastCollected(APPLE)).toBeNull();

  // A day short of the interval.
  now = new Date("2026-10-05T05:00:00Z");
  await collector.check();

  expect(source.search).toHaveBeenCalledOnce();

  now = new Date("2026-10-06T05:00:00Z");
  await collector.check();

  expect(source.search).toHaveBeenCalledTimes(2);
  // Overlaps the last collection by a day.
  expect(source.search.mock.calls[1][0]).toMatchObject({
    since: new Date("2026-10-02T05:00:00Z"),
  });
});

test("a listing whose collection fails leaves the rest collected", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(noop);

  const source = forum(async (query) =>
    query.symbol.symbol === TSMC.symbol
      ? [
          {
            id: "post",
            url: "https://www.ptt.cc/bbs/Stock/M.1.A.1.html",
            title: "[新聞] 台積電",
            snippet: "",
            site: "ptt.cc",
            published: {
              at: new Date("2026-10-03T01:00:00Z"),
              precision: TimePrecision.Minute,
            },
            votes: 3,
          },
        ]
      : []
  );

  const collector = createNewsCollector({
    sources: async () => [source],
    store: news.store,
    scorer: async () => ({
      score: async () => {
        throw new Error("decisions model down");
      },
    }),
    marketData: async () => undefined,
    watchlist: () => [TSMC, FOXCONN],
    collectEveryHours: () => 72,
    now: () => new Date("2026-10-03T05:00:00Z"),
  });

  await collector.check();

  expect(error).toHaveBeenCalledWith(
    "News collection for TW 2330 failed: decisions model down"
  );
  expect(source.search).toHaveBeenCalledTimes(2);
  // Stored before scoring failed, so the next collection scores it.
  expect(
    news.store.list(TSMC, new Date("2026-10-01T00:00:00Z"))[0].score
  ).toBeNull();
  expect(news.store.lastCollected(FOXCONN)).not.toBeNull();
});

test("an interval of 0 collects nothing", async () => {
  const source = forum(async () => []);

  const collector = createNewsCollector({
    sources: async () => [source],
    store: news.store,
    scorer: async () => undefined,
    marketData: async () => undefined,
    watchlist: () => [TSMC],
    collectEveryHours: () => 0,
  });

  await collector.check();

  expect(source.search).not.toHaveBeenCalled();
});

test("a source that keeps failing rests, and a listing only it covers waits for it", async () => {
  const MEDIATEK = { market: Market.TW, symbol: "2454" };
  let now = new Date("2026-10-03T05:00:00Z");

  const broken = {
    id: "broken",
    channel: NewsChannel.Social,
    markets: [Market.TW, Market.US],
    search: vi.fn<NewsSource["search"]>(async () => {
      throw new Error("Firecrawl returned 402");
    }),
  };

  const working = forum(async () => []);

  const collector = createNewsCollector({
    sources: async () => [broken, working],
    store: news.store,
    scorer: async () => undefined,
    marketData: async () => undefined,
    watchlist: () => [TSMC, FOXCONN, MEDIATEK, APPLE],
    collectEveryHours: () => 72,
    now: () => now,
  });

  await collector.check();

  // Rests after its third failure in a row, while the forum still covers Taiwan.
  expect(broken.search).toHaveBeenCalledTimes(3);
  expect(working.search).toHaveBeenCalledTimes(3);
  expect(news.store.lastCollected(APPLE)).toBeNull();

  now = new Date("2026-10-03T11:00:00Z");
  await collector.check();

  expect(broken.search).toHaveBeenCalledTimes(4);
  expect(broken.search.mock.calls[3][0].symbol).toEqual(APPLE);
  expect(news.store.lastCollected(APPLE)).toEqual(now);
});
