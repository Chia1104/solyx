import { DatabaseSync } from "node:sqlite";

import { drizzle } from "drizzle-orm/node-sqlite";
import { migrate } from "drizzle-orm/node-sqlite/migrator";

const CONNECTION_PRAGMAS = `
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
`;

/**
 * Opens a database file and brings it up to date; the file is closed again if either fails. A
 * `durable` one syncs each commit to disk before the commit returns, so the computer losing power
 * keeps it; any other may lose its last commits that way, which a crash of the app never does.
 */
export function connect(
  path: string,
  migrationsFolder: string,
  { durable = false } = {}
) {
  const client = new DatabaseSync(path);

  try {
    client.exec(CONNECTION_PRAGMAS);
    client.exec(`PRAGMA synchronous = ${durable ? "FULL" : "NORMAL"};`);

    const db = drizzle({ client });

    migrate(db, { migrationsFolder });

    return { client, db };
  } catch (error) {
    client.close();
    throw error;
  }
}
