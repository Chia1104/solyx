import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";

import { watchFile } from "../src/server.ts";

let directory: string;

let file: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "solyx-watch-"));
  file = join(directory, "config.json");
});

afterEach(async () => {
  vi.useRealTimers();
  await rm(directory, { recursive: true, force: true });
});

/**
 * Saves the file until the watcher has noticed, which shows as its debounce waiting. The system
 * starts watching a folder a moment after `watch` returns, and a save made before then is never
 * reported, so one save alone may go unseen.
 */
async function saveUntilNoticed() {
  while (vi.getTimerCount() === 0) {
    await writeFile(file, "{}");
    await new Promise((resolve) => setImmediate(resolve));
  }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});

test("reports a change to the file once, however many saves made it", async () => {
  const onChange = vi.fn();
  const stop = watchFile(file, onChange);

  await saveUntilNoticed();

  expect(onChange).not.toHaveBeenCalled();

  vi.runAllTimers();
  stop();

  expect(onChange).toHaveBeenCalledOnce();
});

test("stopping drops a change still waiting to be reported", async () => {
  const onChange = vi.fn();
  const stop = watchFile(file, onChange);

  await saveUntilNoticed();
  stop();
  vi.runAllTimers();

  expect(onChange).not.toHaveBeenCalled();
});
