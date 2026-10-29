import {
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import * as z from "zod";

import type { AppChannel } from "@solyx/api/app-channel";
import { parseJson } from "@solyx/utils/json";

const KEPT_RECORDS = 20;

/** The error the backend ended on, left beside the records for the main process to take into one. */
const LEFT_ERROR_FILE = "backend-error.json";

const FRAME = /^\s+at /;

/** An uncaught error as a record keeps it: its type and stack frames, never its message. */
const fatalErrorSchema = z.object({
  /** `null` for a value thrown that is not an `Error`, which has neither type nor frames. */
  type: z.string().nullable(),
  frames: z.array(z.string()),
});

type FatalError = z.infer<typeof fatalErrorSchema>;

interface CrashRecord {
  /** ISO 8601, in UTC. */
  time: string;
  version: string;
  channel: AppChannel;
  /** The platform, the architecture and the system's version. */
  system: string;
  electron: string;
  code: number;
  /** Electron's reason, such as `abnormal-exit` or `crashed`; `null` for a clean exit. */
  reason: string | null;
  error: FatalError | null;
}

/** Where the app keeps a record of each time its backend ended while it ran. */
function crashFolder(dataDir: string) {
  return join(dataDir, "crashes");
}

function fatalErrorOf(cause: unknown, home: string): FatalError {
  if (!(cause instanceof Error)) return { type: null, frames: [] };

  // The header is the message, which may span lines.
  const header = String(cause);
  const stack = cause.stack ?? "";
  const trace = stack.startsWith(header) ? stack.slice(header.length) : stack;
  const homeUrl = pathToFileURL(home).href;

  return {
    type: cause.constructor.name || cause.name,
    frames: trace
      .split("\n")
      .filter((line) => FRAME.test(line))
      .map((line) =>
        line.trim().replaceAll(homeUrl, "~").replaceAll(home, "~")
      ),
  };
}

/**
 * Leaves the type and stack frames of the error the backend ends on, for the main process to keep
 * in its record. The message stays out, since it can carry a key or what the user wrote, and so
 * does the home folder, which names the user. Writes at once, since the process ends right after.
 */
export function leaveFatalError(dataDir: string, home: string, cause: unknown) {
  const folder = crashFolder(dataDir);

  try {
    mkdirSync(folder, { recursive: true });
    writeFileSync(
      join(folder, LEFT_ERROR_FILE),
      JSON.stringify(fatalErrorOf(cause, home))
    );
  } catch {
    // The record is kept without the error, rather than a second failure ending the process.
  }
}

/** Removes an error an earlier run left, which no record of this run's backend may take. */
export function clearFatalError(dataDir: string) {
  rmSync(join(crashFolder(dataDir), LEFT_ERROR_FILE), { force: true });
}

function takeFatalError(folder: string): FatalError | null {
  const file = join(folder, LEFT_ERROR_FILE);
  let text: string;

  try {
    text = readFileSync(file, "utf8");
  } catch {
    return null;
  }

  rmSync(file, { force: true });

  return parseJson(text, fatalErrorSchema) ?? null;
}

/** Drops the oldest records past the kept ones; record names sort by time. */
function prune(folder: string) {
  const records = readdirSync(folder)
    .filter((name) => name.endsWith(".json") && name !== LEFT_ERROR_FILE)
    .sort();

  for (const name of records.slice(0, -KEPT_RECORDS)) {
    rmSync(join(folder, name), { force: true });
  }
}

/**
 * Keeps a record of the backend ending, with the error it left as it ended, and drops the oldest
 * past the last few. Returns the record and its file, `null` where it could not be written.
 */
export function keepCrashRecord(
  dataDir: string,
  ending: Omit<CrashRecord, "time" | "error">
) {
  const folder = crashFolder(dataDir);

  const record: CrashRecord = {
    time: new Date().toISOString(),
    ...ending,
    error: takeFatalError(folder),
  };

  // Windows allows no colon in a file's name.
  const file = join(folder, `${record.time.replaceAll(":", "-")}.json`);

  try {
    mkdirSync(folder, { recursive: true });
    writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
    prune(folder);
  } catch {
    // The app still says how the backend ended, and quits.
    return { record, file: null };
  }

  return { record, file };
}
