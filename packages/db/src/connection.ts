import { DatabaseSync } from "node:sqlite";

import { drizzle } from "drizzle-orm/node-sqlite";
import { migrate } from "drizzle-orm/node-sqlite/migrator";

const CONNECTION_PRAGMAS = `
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  PRAGMA foreign_keys = ON;
`;

/** Opens a database file and brings it up to date; the file is closed again if either fails. */
export function connect(path: string, migrationsFolder: string) {
  const client = new DatabaseSync(path);

  try {
    client.exec(CONNECTION_PRAGMAS);

    const db = drizzle({ client });

    migrate(db, { migrationsFolder });

    return { client, db };
  } catch (error) {
    client.close();
    throw error;
  }
}
