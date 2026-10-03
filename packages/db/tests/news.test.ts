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

import { listingNews, newsItems } from "../src/news-schema.ts";
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
test.each([newsItems, listingNews])(
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
