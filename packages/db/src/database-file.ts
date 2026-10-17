import { rmSync, statSync } from "node:fs";

import { sumBy } from "es-toolkit";

// A database in WAL mode gets its write-ahead log and shared memory beside it as soon as it is read.
const SIDE_SUFFIXES = ["-wal", "-shm"];

const FILE_SUFFIXES = ["", ...SIDE_SUFFIXES];

/** What a database takes up on disk, with its write-ahead log. */
export function databaseBytes(path: string) {
  return sumBy(
    FILE_SUFFIXES,
    (suffix) =>
      statSync(`${path}${suffix}`, { throwIfNoEntry: false })?.size ?? 0
  );
}

/** Deletes the files a database in WAL mode keeps beside it, leaving the database. */
export function removeSideFiles(path: string) {
  for (const suffix of SIDE_SUFFIXES) {
    rmSync(`${path}${suffix}`, { force: true });
  }
}

/** Deletes a database and the files beside it. */
export function removeDatabase(path: string) {
  rmSync(path, { force: true });
  removeSideFiles(path);
}
