import { rmSync, statSync } from "node:fs";

import { sumBy } from "es-toolkit";

// A database and, in WAL mode, its write-ahead log and shared memory.
const FILE_SUFFIXES = ["", "-wal", "-shm"];

/** What a database takes up on disk, with its write-ahead log. */
export function databaseBytes(path: string) {
  return sumBy(
    FILE_SUFFIXES,
    (suffix) =>
      statSync(`${path}${suffix}`, { throwIfNoEntry: false })?.size ?? 0
  );
}

/** Deletes a database and the files beside it. */
export function removeDatabase(path: string) {
  for (const suffix of FILE_SUFFIXES) {
    rmSync(`${path}${suffix}`, { force: true });
  }
}
