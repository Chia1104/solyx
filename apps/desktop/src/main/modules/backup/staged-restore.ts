import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

import * as z from "zod";

import { isErrnoError } from "@solyx/utils/error";

import { backupPlaces } from "./backup-places.ts";
import type { DataFolders } from "./backup-places.ts";

// A database in WAL mode keeps these beside it, which belong to the file they were written for.
const SIDE_FILES = ["-wal", "-shm"];

const stagedSchema = z.object({
  /** The backup's key in the bucket. */
  key: z.string().min(1),
  /** When the backup was made. */
  createdAt: z.number().int().nonnegative(),
});

/** A backup that was downloaded and checked, for the app to start on. */
export type StagedRestore = z.infer<typeof stagedSchema>;

/** The folder a restore works in, beside the databases so that moving a file into place is a rename. */
export function restorePaths(dataDir: string) {
  const folder = join(dataDir, "restore");

  return {
    folder,
    /** The backup as it was downloaded, sealed. */
    download: join(folder, "download"),
    /** The backup unpacked, each part where `BackupPlace.part` names it. */
    staged: join(folder, "staged"),
    /** Written last, once `staged` is whole and checked. */
    pending: join(folder, "pending.json"),
    /** Written once every place is moved out to `previous`, so a pass that starts over moves none of the backup's own. */
    cleared: join(folder, "cleared"),
    /** What `pending` becomes once the files are in place, until the order desk has opened on them. */
    applied: join(folder, "applied.json"),
    /** What the places held before, kept until the next restore. */
    previous: join(folder, "previous"),
  };
}

function readMarker(file: string): StagedRestore | null {
  try {
    return stagedSchema.parse(JSON.parse(readFileSync(file, "utf8")));
  } catch {
    return null;
  }
}

/** Marks an unpacked and checked backup as the one the app starts on next. */
export function stageRestore(dataDir: string, staged: StagedRestore) {
  writeFileSync(restorePaths(dataDir).pending, JSON.stringify(staged));
}

/** Whether anything is at `path`, a link that points nowhere included. */
const there = (path: string) =>
  lstatSync(path, { throwIfNoEntry: false }) !== undefined;

/**
 * Moves a file or folder to where nothing is, unless it was moved already. Between two volumes,
 * where a rename cannot go, it is copied under another name and renamed once whole, so what is at
 * `to` is always all of it, and a move cut off after that has only `from` left to remove.
 */
function move(from: string, to: string) {
  if (there(to)) {
    rmSync(from, { recursive: true, force: true });

    return;
  }

  if (!there(from)) return;

  mkdirSync(dirname(to), { recursive: true });

  try {
    renameSync(from, to);
  } catch (error) {
    if (!isErrnoError(error, "EXDEV")) throw error;

    const copy = `${to}.restoring`;

    rmSync(copy, { recursive: true, force: true });
    cpSync(from, copy, { recursive: true, verbatimSymlinks: true });
    renameSync(copy, to);
    rmSync(from, { recursive: true, force: true });
  }
}

/** A restore whose files could not all be put in place, so the app must not start on them. */
export class RestoreFailure extends Error {
  /** The folder that holds the restore, for the user to find. */
  readonly folder: string;

  constructor(folder: string, cause: unknown) {
    super("A restored backup could not be put in place", { cause });
    this.name = "RestoreFailure";
    this.folder = folder;
  }
}

/**
 * Puts a staged backup in place of what the app keeps, before anything opens a file, and returns
 * the restore the app is starting on, or `null` when there is none. What each place held is moved
 * to `previous` rather than deleted, a database with its log, since a log left beside the
 * database put in its place would be read into it. A pass cut off partway goes on from where it
 * stopped the next time: each move is skipped once made and finished where only part of it was,
 * and none of the backup's files goes in before every place is cleared.
 */
export function takeRestore(folders: DataFolders): StagedRestore | null {
  const paths = restorePaths(folders.dataDir);

  if (readMarker(paths.pending)) {
    const places = backupPlaces(folders);

    try {
      if (!existsSync(paths.cleared)) {
        for (const { part, path } of places) {
          for (const suffix of [...SIDE_FILES, ""]) {
            move(`${path}${suffix}`, join(paths.previous, `${part}${suffix}`));
          }
        }

        writeFileSync(paths.cleared, "");
      }

      // Every place is empty by now, so one that holds something holds the backup's.
      for (const { part, path } of places) move(join(paths.staged, part), path);

      // From here the app starts on the backup; what is left only tidies up.
      renameSync(paths.pending, paths.applied);
      rmSync(paths.cleared, { force: true });
      rmSync(paths.staged, { recursive: true, force: true });
    } catch (error) {
      throw new RestoreFailure(paths.folder, error);
    }
  }

  return readMarker(paths.applied);
}

/** Forgets the restore the app started on, once whatever had to follow it has. */
export function settleRestore(dataDir: string) {
  rmSync(restorePaths(dataDir).applied, { force: true });
}
