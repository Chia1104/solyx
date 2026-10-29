import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";

import { AppChannel } from "@solyx/api/app-channel";

import {
  clearFatalError,
  keepCrashRecord,
  leaveFatalError,
} from "../src/utility/crash-log.ts";

const HOME = "/Users/someone";

const ENDING = {
  version: "0.0.1-nightly.20261029.140",
  channel: AppChannel.Nightly,
  system: "darwin arm64 26.1",
  electron: "45.0.0",
  code: 1,
  reason: "abnormal-exit",
};

let dataDir: string;

function written(file: string | null) {
  if (file === null) throw new Error("No record was written");

  return readFileSync(file, "utf8");
}

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "solyx-crash-log-"));
});

afterEach(() => {
  vi.useRealTimers();
  rmSync(dataDir, { recursive: true, force: true });
});

test("a record keeps the error's type and frames, never its message or the home folder", () => {
  const error = new TypeError(
    `Longbridge refused key sk-live-123 for ${HOME}\n    at not a frame`
  );

  error.stack = [
    String(error),
    `    at onTrades (file://${HOME}/Solyx/dist/utility/backend.mjs:120:7)`,
    `    at ${HOME}/strategies/run.mjs:4:1`,
    "    at node:internal/timers:685:17",
  ].join("\n");

  leaveFatalError(dataDir, HOME, error);

  const { record, file } = keepCrashRecord(dataDir, ENDING);

  expect(record.error).toEqual({
    type: "TypeError",
    frames: [
      "at onTrades (~/Solyx/dist/utility/backend.mjs:120:7)",
      "at ~/strategies/run.mjs:4:1",
      "at node:internal/timers:685:17",
    ],
  });
  expect(record).toMatchObject(ENDING);

  const text = written(file);

  expect(text).not.toContain("sk-live-123");
  expect(text).not.toContain(HOME);
  expect(JSON.parse(text)).toEqual(record);
});

test("a value thrown that is not an error is kept as one, without the value", () => {
  leaveFatalError(dataDir, HOME, "sk-live-123");

  const { record, file } = keepCrashRecord(dataDir, ENDING);

  expect(record.error).toEqual({ type: null, frames: [] });
  expect(written(file)).not.toContain("sk-live-123");
});

test("an error is taken into one record only, and one an earlier run left into none", () => {
  leaveFatalError(dataDir, HOME, new Error("first"));
  keepCrashRecord(dataDir, ENDING);

  expect(keepCrashRecord(dataDir, ENDING).record.error).toBeNull();

  leaveFatalError(dataDir, HOME, new Error("before this run"));
  clearFatalError(dataDir);

  expect(keepCrashRecord(dataDir, ENDING).record.error).toBeNull();
});

test("a record that cannot be written is still returned, without a file", () => {
  writeFileSync(join(dataDir, "crashes"), "");

  expect(keepCrashRecord(dataDir, ENDING)).toEqual({
    record: expect.objectContaining({ code: 1, error: null }),
    file: null,
  });
});

test("only the newest records are kept", () => {
  vi.useFakeTimers();

  const files = Array.from({ length: 22 }, (_, minute) => {
    vi.setSystemTime(new Date(Date.UTC(2026, 9, 29, 15, minute)));

    return keepCrashRecord(dataDir, ENDING).file;
  });

  const kept = readdirSync(join(dataDir, "crashes")).sort();

  expect(kept).toHaveLength(20);
  expect(kept[0]).toBe("2026-10-29T15-02-00.000Z.json");
  expect(files.at(-1)).toBe(join(dataDir, "crashes", kept.at(-1) ?? ""));
});
