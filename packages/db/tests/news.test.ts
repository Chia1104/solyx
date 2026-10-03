import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { getTableConfig } from "drizzle-orm/sqlite-core";
import { afterEach, beforeEach, expect, test } from "vite-plus/test";

import { Market } from "@solyx/core/market";
import { NewsChannel } from "@solyx/core/news";
import type { NewsItem } from "@solyx/core/news";
import { Stance, TextKind, TextTopic } from "@solyx/core/sentiment";
import type { SentimentScore } from "@solyx/core/sentiment";

import {
  listingNews,
  newsCollections,
  newsItems,
  newsSourceHealth,
} from "../src/news-schema.ts";
import { openNews } from "../src/news.ts";
import type { NewsData } from "../src/news.ts";

const MIGRATIONS = fileURLToPath(
  new URL("../migrations/news", import.meta.url)
);

const TSMC = { market: Market.TW, symbol: "2330" };

const FOXCONN = { market: Market.TW, symbol: "2317" };

const PTT = { id: "ptt-stock", channel: NewsChannel.Forum };

const NEWS = { id: "firecrawl-news", channel: NewsChannel.Article };

const FOUND = new Date("2026-10-03T05:00:00Z");

function item(id: string, publishedAt: string | null, votes = 0): NewsItem {
  return {
    id,
    url: `https://news.test/${id}`,
    title: `title ${id}`,
    snippet: `snippet ${id}`,
    site: "news.test",
    publishedAt: publishedAt === null ? null : new Date(publishedAt),
    votes,
  };
}

const SCORE: SentimentScore = {
  model: "jev-1.13.0",
  relevance: 0.9,
  stance: {
    [Stance.Negative]: 0,
    [Stance.LeanNegative]: 0.1,
    [Stance.Neutral]: 0.2,
    [Stance.LeanPositive]: 0.4,
    [Stance.Positive]: 0.3,
  },
  kind: {
    [TextKind.Report]: 0.7,
    [TextKind.Opinion]: 0.3,
    [TextKind.Promotion]: 0,
  },
  topic: {
    [TextTopic.Earnings]: 0,
    [TextTopic.Guidance]: 1,
    [TextTopic.Business]: 0,
    [TextTopic.Capital]: 0,
    [TextTopic.Analyst]: 0,
    [TextTopic.Legal]: 0,
    [TextTopic.Market]: 0,
    [TextTopic.Other]: 0,
  },
};

let directory: string;

let opened: NewsData[];

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "solyx-news-"));
  opened = [];
});

afterEach(async () => {
  for (const news of opened) news.close();
  await rm(directory, { recursive: true, force: true });
});

function open() {
  const news = openNews(join(directory, "news.sqlite"), MIGRATIONS);

  opened.push(news);

  return news;
}

// A schema change committed without `db:generate` fails here.
test.each([newsItems, listingNews, newsCollections, newsSourceHealth])(
  "migrations build the tables the schema describes",
  (table) => {
    open().close();
    opened = [];

    const db = new DatabaseSync(join(directory, "news.sqlite"));
    const config = getTableConfig(table);

    const columns = db
      .prepare(`SELECT name, type, "notnull" FROM pragma_table_info(?)`)
      .all(config.name)
      .map((column) => [
        column.name,
        String(column.type).toLowerCase(),
        column.notnull === 1,
      ]);

    db.close();

    expect(columns).toEqual(
      config.columns.map((column) => [
        column.name,
        column.getSQLType(),
        column.notNull && !column.primary,
      ])
    );
  }
);

test("a listing's records come newest first, undated ones by when they were found", () => {
  const { store } = open();

  store.save(
    TSMC,
    PTT,
    [
      item("old", "2026-09-20T00:00:00Z"),
      item("new", "2026-10-02T00:00:00Z"),
      item("undated", null),
    ],
    FOUND
  );
  store.save(FOXCONN, NEWS, [item("other", "2026-10-02T00:00:00Z")], FOUND);

  const records = store.list(TSMC, new Date("2026-09-26T00:00:00Z"));

  expect(records.map((record) => record.item.id)).toEqual(["undated", "new"]);
  expect(records[1]).toEqual({
    source: "ptt-stock",
    channel: NewsChannel.Forum,
    item: item("new", "2026-10-02T00:00:00Z"),
    foundAt: FOUND,
    score: null,
  });
});

test("an item found again keeps its score and first time, and takes the latest votes", () => {
  const { store } = open();
  const since = new Date("2026-09-26T00:00:00Z");

  store.save(TSMC, PTT, [item("a", "2026-10-02T00:00:00Z", 10)], FOUND);

  const [record] = store.list(TSMC, since);

  store.saveScore(TSMC, record, SCORE);
  store.save(
    TSMC,
    PTT,
    [item("a", "2026-10-02T00:05:00Z", 61)],
    new Date("2026-10-04T00:00:00Z")
  );

  expect(store.list(TSMC, since)).toEqual([
    {
      ...record,
      item: { ...record.item, votes: 61 },
      score: SCORE,
    },
  ]);
});

test("one item found for two listings is scored for each on its own", () => {
  const { store } = open();
  const since = new Date("2026-09-26T00:00:00Z");
  const shared = item("both", "2026-10-02T00:00:00Z");

  store.save(TSMC, NEWS, [shared], FOUND);
  store.save(FOXCONN, NEWS, [shared], FOUND);

  const [record] = store.list(TSMC, since);

  store.saveScore(TSMC, record, SCORE);

  expect(store.list(TSMC, since)[0].score).toEqual(SCORE);
  expect(store.list(FOXCONN, since)[0].score).toBeNull();
});

test("records outlive the connection", () => {
  const first = open();

  first.store.save(TSMC, PTT, [item("kept", "2026-10-02T00:00:00Z")], FOUND);
  first.close();
  opened = [];

  expect(
    open().store.list(TSMC, new Date("2026-09-26T00:00:00Z"))
  ).toHaveLength(1);
});

test("the last collection is kept per listing", () => {
  const { store } = open();
  const later = new Date("2026-10-04T05:00:00Z");

  expect(store.lastCollected(TSMC)).toBeNull();

  store.markCollected(TSMC, FOUND);
  store.markCollected(TSMC, later);
  store.markCollected(FOXCONN, FOUND);

  expect(store.lastCollected(TSMC)).toEqual(later);
  expect(store.lastCollected(FOXCONN)).toEqual(FOUND);
});

test("a source's failures count up until a search of it works", () => {
  const { store } = open();
  const at = (hour: number) => new Date(Date.UTC(2026, 9, 3, hour));

  expect(store.sourceHealth()).toEqual([]);

  store.markSearched(NEWS.id, at(1), null);
  store.markSearched(NEWS.id, at(2), "402 Payment Required");
  store.markSearched(NEWS.id, at(3), "402 Payment Required");
  store.markSearched(PTT.id, at(3), "timed out");

  expect(store.sourceHealth()).toEqual(
    expect.arrayContaining([
      {
        source: NEWS.id,
        lastSuccessAt: at(1),
        lastFailureAt: at(3),
        failureStreak: 2,
        lastError: "402 Payment Required",
      },
      {
        source: PTT.id,
        lastSuccessAt: null,
        lastFailureAt: at(3),
        failureStreak: 1,
        lastError: "timed out",
      },
    ])
  );

  store.markSearched(NEWS.id, at(4), null);

  expect(
    store.sourceHealth().find((health) => health.source === NEWS.id)
  ).toMatchObject({ lastSuccessAt: at(4), failureStreak: 0 });
});
