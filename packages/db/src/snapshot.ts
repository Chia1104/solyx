import { basename } from "node:path";
import { DatabaseSync, backup } from "node:sqlite";

import { CURRENT_SQLITE_SCHEMA_VERSION } from "@earendil-works/pi-durable/storage/sqlite";
import { sql } from "drizzle-orm";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { drizzle } from "drizzle-orm/node-sqlite";
import type { NodeSQLiteDatabase } from "drizzle-orm/node-sqlite";

import { removeSideFiles } from "./database-file.ts";

// Every page in one step, so the copy is the database as it stood at one moment: a copy made in
// several starts over whenever the connection that has the database open writes between two.
const EVERY_PAGE = 2 ** 31 - 1;

/**
 * Copies a database as it stands at one moment into one file, its write-ahead log folded in,
 * while whoever has it open goes on reading and writing.
 */
export async function snapshotDatabase(
  path: string,
  file: string
): Promise<void> {
  const source = new DatabaseSync(path, { readOnly: true });

  try {
    await backup(source, file, { rate: EVERY_PAGE });
  } finally {
    source.close();
  }
}

/** Reads a snapshot without changing it, once its pages are known to hold together. */
function inspect(file: string, check: (db: NodeSQLiteDatabase) => void) {
  const client = new DatabaseSync(file, { readOnly: true });

  try {
    const db = drizzle({ client });

    const [first] = db.all<{ integrity_check: string }>(
      sql`PRAGMA integrity_check`
    );

    if (first?.integrity_check !== "ok") {
      throw new Error(`${basename(file)} is damaged`);
    }

    check(db);
  } finally {
    client.close();
    removeSideFiles(file);
  }
}

const newer = (file: string) =>
  new Error(
    `${basename(file)} was written by a newer Solyx than this one; update Solyx first`
  );

/**
 * Refuses a snapshot of one of the app's own databases that is damaged, or that holds a migration
 * this build does not have, which opening it would not notice. One a build before this made is
 * brought up to date when it is opened. Migrations are told apart by name, as drizzle tells which
 * to run, since a hash covers the file's line endings, which differ by the system that built it.
 */
export function verifySnapshot(file: string, migrationsFolder: string) {
  const known = new Set(
    readMigrationFiles({ migrationsFolder }).map(({ name }) => name)
  );

  inspect(file, (db) => {
    const applied = db.all<{ name: string | null }>(
      sql`SELECT name FROM __drizzle_migrations`
    );

    if (applied.some(({ name }) => name === null || !known.has(name))) {
      throw newer(file);
    }
  });
}

/** The same for a snapshot of the agent's conversations, by pi-durable's schema version. */
export function verifyAgentSnapshot(file: string) {
  inspect(file, (db) => {
    const schema = db.get<{ version: number } | undefined>(
      sql`SELECT version FROM durable_schema WHERE singleton = 1`
    );

    if (schema === undefined) {
      throw new Error(`${basename(file)} does not hold conversations`);
    }

    if (schema.version > CURRENT_SQLITE_SCHEMA_VERSION) throw newer(file);
  });
}
