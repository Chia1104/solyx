import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { getTableConfig } from "drizzle-orm/sqlite-core";
import { afterEach, beforeEach, expect, test } from "vite-plus/test";

import { Market } from "@solyx/core/market";
import { MemoryKind } from "@solyx/core/memory";
import type { MemoryDraft } from "@solyx/core/memory";

import { memories, memoryVectors } from "../src/memory-schema.ts";
import { openMemory } from "../src/memory.ts";
import type { MemoryData } from "../src/memory.ts";

const MIGRATIONS = fileURLToPath(
  new URL("../migrations/memory", import.meta.url)
);

const TSMC = { market: Market.TW, symbol: "2330" };

const AT = 1_790_000_000_000;

function draft(id: string, patch: Partial<MemoryDraft> = {}): MemoryDraft {
  return {
    id,
    kind: MemoryKind.Note,
    listing: null,
    description: id,
    body: "",
    source: "1",
    ...patch,
  };
}

let directory: string;

let opened: MemoryData[];

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "solyx-memory-"));
  opened = [];
});

afterEach(async () => {
  for (const memory of opened) memory.close();
  await rm(directory, { recursive: true, force: true });
});

function open() {
  const memory = openMemory(join(directory, "memory.sqlite"), MIGRATIONS);

  opened.push(memory);

  return memory;
}

// A schema change committed without `db:generate` fails here.
test.each([memories, memoryVectors])(
  "migrations build the table the schema describes",
  (table) => {
    open().close();
    opened = [];

    const db = new DatabaseSync(join(directory, "memory.sqlite"));
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

test("a memory is kept across opens, newest first, and read by id in the order asked", () => {
  const first = open();

  first.store.save(
    draft("a", { listing: TSMC, kind: MemoryKind.Profile, body: "Body" }),
    AT
  );
  first.store.save(draft("b"), AT + 1);
  first.close();
  opened = [];

  const { store } = open();

  expect(store.list().map((memory) => memory.id)).toEqual(["b", "a"]);
  expect(store.read(["a", "gone", "b"]).map((memory) => memory.id)).toEqual([
    "a",
    "b",
  ]);
  expect(store.read(["a"])[0]).toEqual({
    id: "a",
    kind: MemoryKind.Profile,
    listing: TSMC,
    description: "a",
    body: "Body",
    createdAt: AT,
    updatedAt: AT,
    source: "1",
  });
});

test("saving an id again rewrites the memory but keeps when it was created", () => {
  const { store } = open();

  store.save(draft("a", { description: "Old" }), AT);

  const saved = store.save(
    draft("a", { description: "New", source: "2" }),
    AT + 5
  );

  expect(saved).toMatchObject({
    description: "New",
    source: "2",
    createdAt: AT,
    updatedAt: AT + 5,
  });
  expect(store.list()).toHaveLength(1);
});

test("search finds two-character Chinese words and listing codes, best match first", () => {
  const { store } = open();

  store.save(draft("margin", { description: "使用者看好台積電毛利" }), AT);
  store.save(
    draft("listing", {
      description: "Stop below 950",
      listing: TSMC,
      body: "毛利 not the point",
    }),
    AT
  );
  store.save(draft("reply", { description: "回覆用繁體中文" }), AT);

  const ids = (query: string) =>
    store.search(query, 10).map((memory) => memory.id);

  expect(ids("台積")).toEqual(["margin"]);
  expect(ids("2330")).toEqual(["listing"]);
  expect(ids("台積 毛利")).toEqual(["margin", "listing"]);
  expect(ids("the of")).toEqual([]);
  expect(store.search("毛利", 1)).toHaveLength(1);
});

test("rewriting a memory replaces its words, and forgetting one drops it from search", () => {
  const { store } = open();

  store.save(draft("a", { description: "毛利率" }), AT);
  store.save(draft("a", { description: "營收" }), AT + 1);

  expect(store.search("毛利", 10)).toEqual([]);
  expect(store.search("營收", 10)).toHaveLength(1);

  expect(store.forget("a")).toBe(true);
  expect(store.forget("a")).toBe(false);
  expect(store.search("營收", 10)).toEqual([]);
});

test("clearing forgets every memory and its words", () => {
  const memory = open();

  memory.store.save(draft("a", { description: "毛利" }), AT);
  expect(memory.usage().memories).toBe(1);

  memory.clear();

  expect(memory.usage().memories).toBe(0);
  expect(memory.store.search("毛利", 10)).toEqual([]);

  memory.store.save(draft("b", { description: "毛利" }), AT);
  expect(memory.store.search("毛利", 10).map((found) => found.id)).toEqual([
    "b",
  ]);
});

test("a memory's vector is kept by its text, and clearing forgets it", () => {
  const memory = open();

  memory.store.savePassageVectors("small", [
    { text: "Prefers limit orders", values: Float32Array.of(1, 0) },
  ]);

  expect([
    ...memory.store.passageVectors("small", ["Prefers limit orders"]).keys(),
  ]).toEqual(["Prefers limit orders"]);

  memory.clear();

  expect(
    memory.store.passageVectors("small", ["Prefers limit orders"])
  ).toEqual(new Map());
});
