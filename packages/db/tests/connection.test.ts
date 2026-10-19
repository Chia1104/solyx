import { fileURLToPath } from "node:url";

import { expect, test } from "vite-plus/test";

import { connect } from "../src/connection.ts";

const MIGRATIONS = fileURLToPath(
  new URL("../migrations/cache", import.meta.url)
);

// SQLite's numbers for `PRAGMA synchronous`: NORMAL syncs at checkpoints, FULL at every commit.
const NORMAL = 1;

const FULL = 2;

function synchronous(durable: boolean) {
  const { client } = connect(":memory:", MIGRATIONS, { durable });

  try {
    return client.prepare("PRAGMA synchronous").get();
  } finally {
    client.close();
  }
}

test("a durable database syncs each commit to disk, and another only at checkpoints", () => {
  expect(synchronous(true)).toEqual({ synchronous: FULL });
  expect(synchronous(false)).toEqual({ synchronous: NORMAL });
});
