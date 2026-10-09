import { and, eq, inArray, ne } from "drizzle-orm";
import type { NodeSQLiteDatabase } from "drizzle-orm/node-sqlite";
import { blob, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { chunk } from "es-toolkit";

import type { VectorCache } from "@solyx/core/embedding";

/** Float32 values as SQLite keeps them, in the platform's byte order. */
export const toBytes = (values: Float32Array) =>
  Buffer.from(values.buffer, values.byteOffset, values.byteLength);

// Copied, since SQLite's bytes need not start where a Float32Array may.
export const toValues = (bytes: Uint8Array) =>
  new Float32Array(Uint8Array.from(bytes).buffer);

/** A table of texts' vectors, by text, in one space at a time. */
export function passageVectorsTable(name: string) {
  return sqliteTable(
    name,
    {
      space: text().notNull(),
      passage: text().notNull(),
      /** Float32 values in the platform's byte order. */
      vector: blob({ mode: "buffer" }).notNull(),
    },
    (table) => [primaryKey({ columns: [table.space, table.passage] })]
  );
}

/** The `VectorCache` over a table `passageVectorsTable` made. */
export function vectorCache(
  db: NodeSQLiteDatabase,
  table: ReturnType<typeof passageVectorsTable>
): VectorCache {
  return {
    passageVectors(space, texts) {
      // In batches, well under SQLite's limit on a statement's parameters.
      const rows = chunk([...texts], 500).flatMap((batch) =>
        db
          .select({ passage: table.passage, vector: table.vector })
          .from(table)
          .where(and(eq(table.space, space), inArray(table.passage, batch)))
          .all()
      );

      return new Map(
        rows.map(({ passage, vector }) => [passage, toValues(vector)])
      );
    },

    savePassageVectors(space, vectors) {
      db.transaction((tx) => {
        tx.delete(table).where(ne(table.space, space)).run();

        for (const { text: passage, values } of vectors) {
          tx.insert(table)
            .values({ space, passage, vector: toBytes(values) })
            .onConflictDoNothing()
            .run();
        }
      });
    },
  };
}
