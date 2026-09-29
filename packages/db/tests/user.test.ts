import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { getTableConfig } from "drizzle-orm/sqlite-core";
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";

import { Market } from "@solyx/core/market";

import { watchlist } from "../src/user-schema.ts";
import { openUserData } from "../src/user.ts";
import type { UserData } from "../src/user.ts";

const MIGRATIONS = fileURLToPath(
  new URL("../migrations/user", import.meta.url)
);

const TSMC = { market: Market.TW, symbol: "2330" };

const FOXCONN = { market: Market.TW, symbol: "2317" };

const APPLE = { market: Market.US, symbol: "AAPL" };

let directory: string;

let opened: UserData[];

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "solyx-user-"));
  opened = [];
});

afterEach(async () => {
  for (const userData of opened) userData.close();
  await rm(directory, { recursive: true, force: true });
});

function open(file = "user.sqlite") {
  const userData = openUserData(join(directory, file), MIGRATIONS);

  opened.push(userData);

  return userData;
}

describe("openUserData", () => {
  // A schema change committed without `db:generate` fails here.
  test("migrations build the tables the schema describes", () => {
    open().close();
    opened = [];

    const db = new DatabaseSync(join(directory, "user.sqlite"));
    const config = getTableConfig(watchlist);

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

  test("a file that is not a database is kept and reported", async () => {
    const file = join(directory, "garbage.sqlite");

    await writeFile(file, "not a database");

    expect(() => openUserData(file, MIGRATIONS)).toThrow();

    const kept = new DatabaseSync(file, { readOnly: true });

    expect(() => kept.prepare("SELECT 1").get()).toThrow();
    kept.close();
  });

  test("the watchlist outlives the connection", () => {
    const first = open();

    first.watchlist.add(TSMC);
    first.close();
    opened = [];

    expect(open().watchlist.list()).toEqual([TSMC]);
  });
});

describe("watchlist store", () => {
  test("listings keep the order they were added in", () => {
    const { watchlist: store } = open();

    store.add(TSMC);
    store.add(APPLE);
    store.add(FOXCONN);

    expect(store.list()).toEqual([TSMC, APPLE, FOXCONN]);
  });

  test("adding a watched listing again keeps its place", () => {
    const { watchlist: store } = open();

    store.add(TSMC);
    store.add(APPLE);
    store.add(TSMC);

    expect(store.list()).toEqual([TSMC, APPLE]);
  });

  test("removing drops only that listing", () => {
    const { watchlist: store } = open();

    store.add(TSMC);
    store.add(APPLE);
    store.remove(TSMC);
    store.remove(FOXCONN);

    expect(store.list()).toEqual([APPLE]);
  });

  test("markets keep the same code apart", () => {
    const { watchlist: store } = open();
    const listedTwice = { market: Market.US, symbol: "2330" };

    store.add(TSMC);
    store.add(listedTwice);
    store.remove(listedTwice);

    expect(store.list()).toEqual([TSMC]);
  });
});
