import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";

import { openResearch } from "@solyx/db/research";
import type { ResearchData } from "@solyx/db/research";

import { createResearch } from "../src/main/modules/research/research.ts";

const MIGRATIONS = fileURLToPath(
  new URL("../../../packages/db/migrations/research", import.meta.url)
);

let directory: string;

let data: ResearchData;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "solyx-research-"));
  data = openResearch(join(directory, "research.sqlite"), MIGRATIONS);
});

afterEach(async () => {
  data.close();
  await rm(directory, { recursive: true, force: true });
});

test("windows are told as each exchange's day turns, and not otherwise", async () => {
  const clock = { now: Date.parse("2026-10-16T23:58:00+08:00") };
  const onChange = vi.fn();

  const research = createResearch(
    data,
    {
      marketData: { candles: async () => [] },
      fundamentals: { statements: async () => [], dividends: async () => [] },
      auditor: async () => undefined,
      reader: async () => undefined,
      news: { list: () => [] },
      embedder: () => undefined,
      diagnostics: { recovered: vi.fn() },
      now: () => clock.now,
    },
    onChange
  );

  await research.work.run();
  expect(onChange).not.toHaveBeenCalled();

  // Midnight in Taipei.
  clock.now = Date.parse("2026-10-17T00:01:00+08:00");
  await research.work.run();
  await research.work.run();
  expect(onChange).toHaveBeenCalledOnce();

  // Midnight in New York.
  clock.now = Date.parse("2026-10-17T00:01:00-04:00");
  await research.work.run();
  expect(onChange).toHaveBeenCalledTimes(2);
});
