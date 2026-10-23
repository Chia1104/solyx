import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";

import { NewsRetention } from "@solyx/api/news";
import { NewsChannel, NewsVoice } from "@solyx/core/news";
import type { NewsData } from "@solyx/db/news";
import { DAY_MS } from "@solyx/utils/date";

import { createNewsRetention } from "../src/backend/modules/news/news-retention.ts";
import { createConfigFile } from "../src/backend/modules/settings/config-file.ts";

let home: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "solyx-retention-"));
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

const NOW = Date.parse("2026-10-16T00:00:00Z");

function setup() {
  const config = createConfigFile(join(home, ".solyx", "config.json"));

  config.create();

  const prune = vi.fn<NewsData["prune"]>(() => 0);

  const work = createNewsRetention({
    news: { prune },
    config,
    diagnostics: { recovered: vi.fn() },
    now: () => NOW,
  });

  return { config, prune, work };
}

test("a pass drops the press's news after 90 days and the crowd's after 30 until the user says otherwise", async () => {
  const { prune, work } = setup();

  await work.run();

  const press = new Date("2026-07-18T00:00:00Z");
  const crowd = new Date("2026-09-16T00:00:00Z");

  expect(prune).toHaveBeenCalledWith({
    [NewsChannel.Announcement]: press,
    [NewsChannel.Article]: press,
    [NewsChannel.Forum]: crowd,
    [NewsChannel.Social]: crowd,
  });
  expect(work.everyMs).toBe(DAY_MS);
});

test("a changed retention prunes at once, and news kept forever is never pruned", () => {
  const { config, prune } = setup();

  config.set(["news", "kept", NewsVoice.Press], NewsRetention.Forever);
  config.set(["news", "kept", NewsVoice.Crowd], NewsRetention.Year);

  expect(prune).toHaveBeenLastCalledWith({
    [NewsChannel.Announcement]: null,
    [NewsChannel.Article]: null,
    [NewsChannel.Forum]: new Date("2025-10-16T00:00:00Z"),
    [NewsChannel.Social]: new Date("2025-10-16T00:00:00Z"),
  });

  // Saving a change elsewhere in the file prunes nothing.
  prune.mockClear();
  config.set(["updates", "check"], false);

  expect(prune).not.toHaveBeenCalled();
});
