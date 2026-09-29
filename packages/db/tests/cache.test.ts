import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { getTableConfig } from "drizzle-orm/sqlite-core";
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";

import { Interval } from "@solyx/core/candles";
import { Market } from "@solyx/core/market";

import { candleSeries, candles } from "../src/cache-schema.ts";
import { openCache } from "../src/cache.ts";
import type { Cache, CandleSeriesKey } from "../src/cache.ts";

const MIGRATIONS = fileURLToPath(
  new URL("../migrations/cache", import.meta.url)
);

const DAILY: CandleSeriesKey = {
  source: "fugle",
  market: Market.TW,
  symbol: "2330",
  interval: Interval.OneDay,
};

function session(date: string, close = 100) {
  return {
    date,
    candle: {
      time: Date.parse(`${date}T00:00:00+08:00`) / 1000,
      open: close,
      high: close,
      low: close,
      close,
      volume: 1000,
    },
  };
}

let directory: string;

let opened: Cache[];

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "solyx-cache-"));
  opened = [];
});

afterEach(async () => {
  for (const cache of opened) cache.close();
  await rm(directory, { recursive: true, force: true });
});

function open(file = "cache.sqlite") {
  const cache = openCache(join(directory, file), MIGRATIONS);

  opened.push(cache);

  return cache;
}

function reopen(cache: Cache, file = "cache.sqlite") {
  cache.close();
  opened = opened.filter((other) => other !== cache);

  return open(file);
}

describe("openCache", () => {
  // A schema change committed without `db:generate` fails here.
  test("migrations build the tables the schema describes", () => {
    open().close();
    opened = [];

    const db = new DatabaseSync(join(directory, "cache.sqlite"));

    for (const table of [candleSeries, candles]) {
      const config = getTableConfig(table);

      const columns = db
        .prepare(`SELECT name, type, "notnull" FROM pragma_table_info(?)`)
        .all(config.name)
        .map((column) => [
          column.name,
          String(column.type).toLowerCase(),
          column.notnull === 1,
        ]);

      expect(columns).toEqual(
        config.columns.map((column) => [
          column.name,
          column.getSQLType(),
          column.notNull && !column.primary,
        ])
      );
    }

    db.close();
  });

  test("a file holding a schema the migrations do not know is rebuilt", () => {
    const file = join(directory, "stale.sqlite");
    const stale = new DatabaseSync(file);

    stale.exec("CREATE TABLE candle_series (id INTEGER, leftover TEXT);");
    stale.close();
    open("stale.sqlite").close();
    opened = [];

    const reopened = new DatabaseSync(file);

    const columns = reopened
      .prepare("SELECT name FROM pragma_table_info('candle_series')")
      .all()
      .map((column) => column.name);

    reopened.close();

    expect(columns).not.toContain("leftover");
    expect(columns).toContain("covered_to");
  });

  test("a file that is not a database is replaced", async () => {
    await writeFile(join(directory, "garbage.sqlite"), "not a database");

    const { candles: store } = open("garbage.sqlite");

    store.store(DAILY, [session("2026-09-24")], {
      from: "2026-09-24",
      to: "2026-09-24",
    });

    expect(store.read(DAILY, "2026-09-01", "2026-09-30")).toHaveLength(1);
  });

  test("bars outlive the connection", () => {
    const first = open();

    first.candles.store(DAILY, [session("2026-09-24")], {
      from: "2026-09-01",
      to: "2026-09-24",
    });

    const second = reopen(first);

    expect(second.candles.coverage(DAILY)).toEqual({
      from: "2026-09-01",
      to: "2026-09-24",
    });
    expect(second.candles.read(DAILY, "2026-09-01", "2026-09-30")).toEqual([
      session("2026-09-24").candle,
    ]);
  });
});

describe("candle store", () => {
  test("coverage only widens when bars are stored", () => {
    const { candles: store } = open();

    store.store(DAILY, [], { from: "2026-09-10", to: "2026-09-20" });
    store.store(DAILY, [], { from: "2026-09-15", to: "2026-09-18" });
    store.store(DAILY, [], { from: "2026-09-01", to: "2026-09-24" });

    expect(store.coverage(DAILY)).toEqual({
      from: "2026-09-01",
      to: "2026-09-24",
    });
  });

  test("storing a bar again replaces it", () => {
    const { candles: store } = open();
    const coverage = { from: "2026-09-24", to: "2026-09-24" };

    store.store(DAILY, [session("2026-09-24", 100)], coverage);
    store.store(DAILY, [session("2026-09-24", 105)], coverage);

    expect(
      store.read(DAILY, "2026-09-24", "2026-09-24").map((bar) => bar.close)
    ).toEqual([105]);
  });

  test("trimming drops older bars and narrows coverage", () => {
    const { candles: store } = open();

    store.store(DAILY, [session("2026-09-23"), session("2026-09-24")], {
      from: "2026-09-23",
      to: "2026-09-24",
    });
    store.trim(DAILY, "2026-09-24");

    expect(store.coverage(DAILY)?.from).toBe("2026-09-24");
    expect(store.read(DAILY, "2026-09-01", "2026-09-30")).toHaveLength(1);
  });

  test("removing a series deletes its bars", () => {
    const { candles: store } = open();

    store.store(DAILY, [session("2026-09-24")], {
      from: "2026-09-24",
      to: "2026-09-24",
    });
    store.remove(DAILY);

    expect(store.coverage(DAILY)).toBeUndefined();
    expect(store.read(DAILY, "2026-09-01", "2026-09-30")).toEqual([]);
  });

  test("series are kept apart by source, market, symbol and interval", () => {
    const { candles: store } = open();
    const other = { ...DAILY, source: "other" };

    store.store(DAILY, [session("2026-09-24")], {
      from: "2026-09-24",
      to: "2026-09-24",
    });

    expect(store.coverage(other)).toBeUndefined();
    expect(store.read(other, "2026-09-01", "2026-09-30")).toEqual([]);
  });
});
