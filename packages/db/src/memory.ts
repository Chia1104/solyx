import { count, desc, eq, inArray, sql } from "drizzle-orm";
import type { NodeSQLiteDatabase } from "drizzle-orm/node-sqlite";
import { keyBy, uniq } from "es-toolkit";

import type { Memory, MemoryDraft, MemoryStore } from "@solyx/core/memory";
import { searchTerms } from "@solyx/utils/search";

import { connect } from "./connection.ts";
import { databaseBytes } from "./database-file.ts";
import { memories } from "./memory-schema.ts";

function toMemory(row: typeof memories.$inferSelect): Memory {
  return {
    id: row.key,
    kind: row.kind,
    listing:
      row.market === null || row.symbol === null
        ? null
        : { market: row.market, symbol: row.symbol },
    description: row.description,
    body: row.body,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    source: row.source,
  };
}

/** What `memory_terms` holds of a memory: the words of its listing's code, description and body. */
function termsOf(draft: MemoryDraft) {
  return searchTerms(
    [draft.listing?.symbol, draft.description, draft.body].join(" ")
  ).join(" ");
}

function memoryStore(db: NodeSQLiteDatabase): MemoryStore {
  return {
    list: () =>
      db
        .select()
        .from(memories)
        .orderBy(desc(memories.updatedAt), desc(memories.id))
        .all()
        .map(toMemory),

    read(ids) {
      const found = keyBy(
        db.select().from(memories).where(inArray(memories.key, ids)).all(),
        (row) => row.key
      );

      return ids.flatMap((id) => {
        const row = found[id];

        return row ? [toMemory(row)] : [];
      });
    },

    search(query, limit) {
      const terms = uniq(searchTerms(query));

      if (terms.length === 0) return [];

      // Terms hold only letters and digits, so quoting each makes it a plain word to FTS5.
      const match = terms.map((term) => `"${term}"`).join(" OR ");

      const ranked = db.all<{ id: number }>(
        sql`SELECT memories.id AS id FROM memory_terms
          JOIN memories ON memories.id = memory_terms.rowid
          WHERE memory_terms MATCH ${match}
          ORDER BY bm25(memory_terms), memories.updated_at DESC
          LIMIT ${limit}`
      );

      const found = keyBy(
        db
          .select()
          .from(memories)
          .where(
            inArray(
              memories.id,
              ranked.map((row) => row.id)
            )
          )
          .all(),
        (row) => row.id
      );

      return ranked.flatMap(({ id }) => {
        const row = found[id];

        return row ? [toMemory(row)] : [];
      });
    },

    save(draft, at) {
      const fields = {
        kind: draft.kind,
        market: draft.listing?.market ?? null,
        symbol: draft.listing?.symbol ?? null,
        description: draft.description,
        body: draft.body,
        updatedAt: at,
        source: draft.source,
      };

      return db.transaction((tx) => {
        const row = tx
          .insert(memories)
          .values({ key: draft.id, createdAt: at, ...fields })
          .onConflictDoUpdate({ target: memories.key, set: fields })
          .returning()
          .get();

        tx.run(sql`DELETE FROM memory_terms WHERE rowid = ${row.id}`);
        tx.run(
          sql`INSERT INTO memory_terms (rowid, terms) VALUES (${row.id}, ${termsOf(draft)})`
        );

        return toMemory(row);
      });
    },

    forget(id) {
      return db.transaction((tx) => {
        const row = tx
          .delete(memories)
          .where(eq(memories.key, id))
          .returning({ id: memories.id })
          .get();

        if (!row) return false;

        tx.run(sql`DELETE FROM memory_terms WHERE rowid = ${row.id}`);

        return true;
      });
    },
  };
}

export interface MemoryUsage {
  /** The file on disk, with its write-ahead log. */
  bytes: number;
  memories: number;
}

/**
 * What the agent keeps across conversations, each memory saved once the user allowed it. Like the
 * user's database it is never deleted, so a file its migrations cannot open is an error.
 * `migrationsFolder` is `migrations/memory` wherever the host ships it.
 */
export function openMemory(path: string, migrationsFolder: string) {
  const { client, db } = connect(path, migrationsFolder);

  return {
    store: memoryStore(db),

    usage(): MemoryUsage {
      return {
        bytes: databaseBytes(path),
        memories:
          db.select({ memories: count() }).from(memories).get()?.memories ?? 0,
      };
    },

    /** Forgets every memory and gives the space back to the disk. */
    clear() {
      db.transaction((tx) => {
        tx.delete(memories).run();
        tx.run(
          sql`INSERT INTO memory_terms (memory_terms) VALUES ('delete-all')`
        );
      });
      // VACUUM rewrites the file through the log, so the log is truncated after it.
      client.exec("VACUUM; PRAGMA wal_checkpoint(TRUNCATE);");
    },

    close: () => client.close(),
  };
}

export type MemoryData = ReturnType<typeof openMemory>;
