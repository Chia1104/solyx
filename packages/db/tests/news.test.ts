import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { getTableConfig } from "drizzle-orm/sqlite-core";
import { afterEach, beforeEach, expect, test } from "vite-plus/test";

import { Market } from "@solyx/core/market";
import { NewsChannel, TimePrecision } from "@solyx/core/news";
import type { NewsItem } from "@solyx/core/news";
import {
  Stance,
  TextKind,
  TextSpeaker,
  TextTopic,
} from "@solyx/core/sentiment";
import type { SentimentScore } from "@solyx/core/sentiment";

import {
  itemEmbeddings,
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
    published:
      publishedAt === null
        ? null
        : { at: new Date(publishedAt), precision: TimePrecision.Minute },
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
  speaker: {
    [TextSpeaker.Company]: 0,
    [TextSpeaker.Outlet]: 0.9,
    [TextSpeaker.Investor]: 0.1,
    [TextSpeaker.Reference]: 0,
    [TextSpeaker.Other]: 0,
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
test.each([
  newsItems,
  listingNews,
  newsCollections,
  newsSourceHealth,
  itemEmbeddings,
])("migrations build the tables the schema describes", (table) => {
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
});

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

test("a score that misses who speaks reads as no score, so the story is scored again", () => {
  const { store } = open();
  const since = new Date("2026-09-26T00:00:00Z");

  store.save(TSMC, NEWS, [item("a", "2026-10-02T00:00:00Z")], FOUND);
  store.saveScore(TSMC, store.list(TSMC, since)[0], SCORE);

  const db = new DatabaseSync(join(directory, "news.sqlite"));

  db.exec("UPDATE listing_news SET speaker = NULL");
  db.close();

  expect(store.list(TSMC, since)[0].score).toBeNull();
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

test("clearing deletes every item and each listing's last collection, and keeps source health", () => {
  const news = open();

  news.store.save(
    TSMC,
    PTT,
    Array.from({ length: 500 }, (_, index) => item(`p${index}`, null)),
    FOUND
  );
  news.store.save(FOXCONN, PTT, [item("p0", null)], FOUND);
  news.store.markCollected(TSMC, FOUND);
  news.store.markSearched(NEWS.id, FOUND, "rate limited");

  const before = news.usage();

  expect(before).toEqual({ bytes: expect.any(Number), items: 500 });

  news.clear();

  expect(news.usage()).toEqual({ bytes: expect.any(Number), items: 0 });
  expect(news.usage().bytes).toBeLessThan(before.bytes);
  expect(news.store.list(TSMC, new Date(0))).toEqual([]);
  expect(news.store.search("title", 5)).toEqual([]);
  expect(news.store.lastCollected(TSMC)).toBeNull();
  expect(news.store.sourceHealth()).toEqual([
    expect.objectContaining({ source: NEWS.id, failureStreak: 1 }),
  ]);
});

test("a search finds items by title and snippet with every listing they were found for", () => {
  const { store } = open();

  store.save(
    TSMC,
    NEWS,
    [
      {
        ...item("a", "2026-10-01T02:00:00Z"),
        title: "台積電法說會上調資本支出",
      },
      {
        ...item("b", "2026-10-02T02:00:00Z"),
        snippet: "Capex guidance raised again",
      },
    ],
    FOUND
  );
  store.save(
    FOXCONN,
    NEWS,
    [
      {
        ...item("b", "2026-10-02T02:00:00Z"),
        snippet: "Capex guidance raised again",
      },
    ],
    new Date(FOUND.getTime() + 1000)
  );
  store.save(
    FOXCONN,
    PTT,
    [{ ...item("c", null), title: "鴻海資本支出" }],
    FOUND
  );

  expect(store.search("資本支出", 5).map(({ item: { id } }) => id)).toEqual([
    "c",
    "a",
  ]);
  expect(store.search("capex", 5)).toEqual([
    {
      source: NEWS.id,
      channel: NEWS.channel,
      item: {
        ...item("b", "2026-10-02T02:00:00Z"),
        snippet: "Capex guidance raised again",
      },
      listings: [TSMC, FOXCONN],
    },
  ]);
  expect(
    store.search("資本支出", 5, FOXCONN).map(({ item: { id } }) => id)
  ).toEqual(["c"]);
  expect(store.search("資本支出", 1)).toHaveLength(1);
  expect(store.search("…", 5)).toEqual([]);
});

test("an item found again is searched by its latest title", () => {
  const { store } = open();

  store.save(
    TSMC,
    NEWS,
    [{ ...item("a", null), title: "Dividend raised" }],
    FOUND
  );
  store.save(
    TSMC,
    NEWS,
    [{ ...item("a", null), title: "Buyback announced" }],
    FOUND
  );

  expect(store.search("dividend", 5)).toEqual([]);
  expect(store.search("buyback", 5).map(({ item: { id } }) => id)).toEqual([
    "a",
  ]);
});

test("items kept before their search existed are found once the file opens", () => {
  const first = open();

  first.store.save(
    TSMC,
    NEWS,
    [{ ...item("a", null), title: "Dividend raised" }],
    FOUND
  );
  first.close();
  opened = [];

  const db = new DatabaseSync(join(directory, "news.sqlite"));

  db.exec("INSERT INTO news_terms (news_terms) VALUES ('delete-all')");
  db.close();

  expect(
    open()
      .store.search("dividend", 5)
      .map(({ item: { id } }) => id)
  ).toEqual(["a"]);
});

test("records carry their items' vectors in the space asked for, and one space is kept at a time", () => {
  const news = open();
  const a = { source: NEWS.id, item: item("a", null) };
  const b = { source: NEWS.id, item: item("b", null) };

  news.store.save(TSMC, NEWS, [a.item, b.item], FOUND);
  news.store.save(FOXCONN, NEWS, [a.item], FOUND);
  news.store.saveEmbeddings("small", [
    { record: a, values: Float32Array.of(0.5, -1.25) },
  ]);

  const vectors = (symbol: typeof TSMC, space?: string) =>
    Object.fromEntries(
      news.store
        .list(symbol, new Date(0), space)
        .map(({ item: { id }, embedding }) => [
          id,
          embedding && [embedding.space, [...embedding.values]],
        ])
    );

  expect(vectors(TSMC, "small")).toEqual({
    b: undefined,
    a: ["small", [0.5, -1.25]],
  });
  expect(vectors(FOXCONN, "small")).toEqual({ a: ["small", [0.5, -1.25]] });
  expect(vectors(TSMC)).toEqual({ b: undefined, a: undefined });

  news.store.saveEmbeddings("large", [
    { record: b, values: Float32Array.of(1, 2, 3) },
    {
      record: { source: NEWS.id, item: item("gone", null) },
      values: Float32Array.of(1),
    },
  ]);

  expect(vectors(TSMC, "small")).toEqual({ b: undefined, a: undefined });
  expect(vectors(TSMC, "large")).toEqual({
    b: ["large", [1, 2, 3]],
    a: undefined,
  });

  news.clear();
  news.store.save(TSMC, NEWS, [b.item], FOUND);

  expect(vectors(TSMC, "large")).toEqual({ b: undefined });
});

test("the items whose vectors read clearly nearest a query are found, for one listing or any", () => {
  const { store } = open();
  const items = ["a", "b", "c", "d", "e"].map((id) => item(id, null));

  store.save(TSMC, NEWS, items, FOUND);
  store.save(FOXCONN, NEWS, [items[4]], FOUND);
  store.saveEmbeddings(
    "small",
    items.map((each, index) => ({
      record: { source: NEWS.id, item: each },
      // "a" lies along the query, "e" near it, the rest across it.
      values:
        index === 0
          ? Float32Array.of(1, 0)
          : index === 4
            ? Float32Array.of(0.9, 0.1)
            : Float32Array.of(0, 1),
    }))
  );

  const nearest = (symbol?: typeof TSMC) =>
    store
      .nearest("small", Float32Array.of(1, 0), 5, symbol)
      .map(({ item: { id }, listings }) => [id, listings.length]);

  expect(nearest()).toEqual([
    ["a", 1],
    ["e", 2],
  ]);
  expect(nearest(FOXCONN)).toEqual([]);
  expect(store.nearest("large", Float32Array.of(1, 0), 5)).toEqual([]);
});
