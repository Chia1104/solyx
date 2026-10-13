import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, expect, test } from "vite-plus/test";

import { Market } from "@solyx/core/market";

import { openAgentStore } from "../src/agent.ts";
import {
  snapshotDatabase,
  verifyAgentSnapshot,
  verifySnapshot,
} from "../src/snapshot.ts";
import { openUserData } from "../src/user.ts";

const MIGRATIONS = fileURLToPath(
  new URL("../migrations/user", import.meta.url)
);

const TSMC = { market: Market.TW, symbol: "2330" };

const FOXCONN = { market: Market.TW, symbol: "2317" };

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "solyx-snapshot-"));
});

afterEach(() => rm(directory, { recursive: true, force: true }));

test("a snapshot is one file that holds what the open database's log still held", async () => {
  const path = join(directory, "user.sqlite");
  const live = openUserData(path, MIGRATIONS);
  const folder = await mkdtemp(join(directory, "copy-"));
  const file = join(folder, "user.sqlite");

  live.watchlist.add(TSMC);
  await snapshotDatabase(path, file);
  // Written after the copy, so it is not in it.
  live.watchlist.add(FOXCONN);

  expect(await readdir(folder)).toEqual(["user.sqlite"]);

  const copy = openUserData(file, MIGRATIONS);

  expect(copy.watchlist.list()).toEqual([TSMC]);
  expect(live.watchlist.list()).toEqual([TSMC, FOXCONN]);

  copy.close();
  live.close();
});

test("a snapshot this build made, or an older one, passes and is left as one file", async () => {
  const live = openUserData(join(directory, "user.sqlite"), MIGRATIONS);
  const folder = await mkdtemp(join(directory, "copy-"));
  const file = join(folder, "user.sqlite");

  live.watchlist.add(TSMC);
  await snapshotDatabase(join(directory, "user.sqlite"), file);
  live.close();

  expect(() => verifySnapshot(file, MIGRATIONS)).not.toThrow();

  // A build before this one had fewer migrations, which opening the file makes up for.
  const older = new DatabaseSync(file);

  older.exec(
    "DELETE FROM __drizzle_migrations WHERE id = (SELECT max(id) FROM __drizzle_migrations)"
  );
  older.close();

  expect(() => verifySnapshot(file, MIGRATIONS)).not.toThrow();
  expect(await readdir(folder)).toEqual(["user.sqlite"]);
});

test("a snapshot a newer build made is refused, since opening it would not notice", async () => {
  const live = openUserData(join(directory, "user.sqlite"), MIGRATIONS);
  const file = join(directory, "copy.sqlite");

  await snapshotDatabase(join(directory, "user.sqlite"), file);
  live.close();

  const newer = new DatabaseSync(file);

  newer.exec(
    "INSERT INTO __drizzle_migrations (hash, created_at, name) VALUES ('a-migration-of-the-future', 4102444800000, '9999_future')"
  );
  newer.close();

  expect(() => verifySnapshot(file, MIGRATIONS)).toThrow(
    "copy.sqlite was written by a newer Solyx than this one"
  );
});

test("a file that is not a database, or another database, is refused", async () => {
  const file = join(directory, "garbage.sqlite");

  await writeFile(file, "not a database");

  expect(() => verifySnapshot(file, MIGRATIONS)).toThrow();

  const other = join(directory, "other.sqlite");
  const database = new DatabaseSync(other);

  database.exec("CREATE TABLE notes (text TEXT)");
  database.close();

  expect(() => verifySnapshot(other, MIGRATIONS)).toThrow();
  expect(() => verifyAgentSnapshot(other)).toThrow();
});

test("the conversations' snapshot passes until pi-durable's schema is ahead of this build's", async () => {
  const path = join(directory, "agent.sqlite");
  const file = join(directory, "copy.sqlite");

  // Left open, as the app has it while a backup is made.
  await openAgentStore(path);
  await snapshotDatabase(path, file);

  expect(() => verifyAgentSnapshot(file)).not.toThrow();

  const newer = new DatabaseSync(file);

  newer.exec("UPDATE durable_schema SET version = version + 1");
  newer.close();

  expect(() => verifyAgentSnapshot(file)).toThrow(
    "copy.sqlite was written by a newer Solyx than this one"
  );
});
