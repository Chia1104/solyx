import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";

import { Market } from "@solyx/core/market";
import { Session } from "@solyx/core/session";
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

test("windows are told as each exchange's day turns and its regular session opens or closes, and not otherwise", async () => {
  const clock = { now: Date.parse("2026-10-16T13:28:00+08:00") };

  const open: Record<Market, Session> = {
    [Market.TW]: Session.Regular,
    [Market.US]: Session.Closed,
  };

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
      sessions: async () => ({ ...open }),
      now: () => clock.now,
    },
    onChange
  );

  // The first pass only reads the clock.
  await research.work.run();
  clock.now = Date.parse("2026-10-16T13:29:00+08:00");
  await research.work.run();
  expect(onChange).not.toHaveBeenCalled();

  // Taipei's regular session closes, so forecasts whose horizon ends today read as settled.
  open[Market.TW] = Session.Post;
  await research.work.run();
  await research.work.run();
  expect(onChange).toHaveBeenCalledOnce();

  // Midnight in Taipei.
  open[Market.TW] = Session.Closed;
  clock.now = Date.parse("2026-10-17T00:01:00+08:00");
  await research.work.run();
  expect(onChange).toHaveBeenCalledTimes(2);

  // Midnight in New York.
  clock.now = Date.parse("2026-10-17T00:01:00-04:00");
  await research.work.run();
  expect(onChange).toHaveBeenCalledTimes(3);
});
