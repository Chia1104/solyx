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

test("reports a change to the file", async () => {
  const changed = new Promise<void>((resolve) => {
    const stop = watchFile(file, () => {
      stop();
      resolve();
    });
  });

  await writeFile(file, "{}");
  await changed;
});

test("stopping drops a change still waiting to be reported", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

  const onChange = vi.fn();
  const stop = watchFile(file, onChange);

  await writeFile(file, "{}");

  // The change is noticed and waits out the debounce.
  while (vi.getTimerCount() === 0) {
    await new Promise((resolve) => setImmediate(resolve));
  }

  stop();
  vi.runAllTimers();

  expect(onChange).not.toHaveBeenCalled();
});
