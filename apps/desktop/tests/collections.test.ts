import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";

import { Market } from "@solyx/core/market";
import { CollectionJob, ScheduleKind } from "@solyx/core/schedule";
import type { CollectionPlan } from "@solyx/core/schedule";

import { createCollections } from "../src/main/modules/schedules/collections.ts";
import {
  DEFAULT_COLLECTION_PLANS,
  createConfigFile,
} from "../src/main/modules/settings/config-file.ts";

let home: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "solyx-collections-"));
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

function setup() {
  const config = createConfigFile(join(home, ".solyx", "config.json"));

  config.create();

  const collector = (lastAt: number | null) => ({
    status: vi.fn(async () => ({ lastAt, nextAt: null })),
    collectNow: vi.fn(async () => undefined),
  });

  const collectors = {
    [CollectionJob.News]: collector(5),
    [CollectionJob.Themes]: collector(null),
  };

  return {
    collections: createCollections({ config, collectors }),
    config,
    collectors,
  };
}

test("each of the app's collections reads with its plan from the config file and its own status", async () => {
  const { collections } = setup();

  expect(await collections.list()).toEqual([
    {
      job: CollectionJob.News,
      plan: DEFAULT_COLLECTION_PLANS[CollectionJob.News],
      lastAt: 5,
      nextAt: null,
    },
    {
      job: CollectionJob.Themes,
      plan: DEFAULT_COLLECTION_PLANS[CollectionJob.Themes],
      lastAt: null,
      nextAt: null,
    },
  ]);
});

test("a plan is saved to the config file, where a plan that no longer parses reads as its default", async () => {
  const { collections, config } = setup();

  const beforeOpen: CollectionPlan = {
    enabled: true,
    schedule: {
      kind: ScheduleKind.FixedTime,
      time: "08:00",
      tradingDaysOf: Market.TW,
    },
    timeZone: "Asia/Taipei",
  };

  collections.set(CollectionJob.News, beforeOpen);

  expect(config.read().collection.news).toEqual(beforeOpen);
  expect((await collections.list())[0].plan).toEqual(beforeOpen);

  // A hand edit to something a collection never waits on.
  config.set(["collection", CollectionJob.News], {
    ...beforeOpen,
    // SAFETY: stands for a hand edit the schema refuses.
    schedule: { kind: ScheduleKind.OnChange, atMostEveryMinutes: 60 } as never,
  });

  expect(config.read().collection.news).toEqual(
    DEFAULT_COLLECTION_PLANS[CollectionJob.News]
  );
});

test("collecting now asks only the collection named", async () => {
  const { collections, collectors } = setup();

  await collections.collectNow(CollectionJob.Themes);

  expect(collectors.themes.collectNow).toHaveBeenCalledOnce();
  expect(collectors.news.collectNow).not.toHaveBeenCalled();
});
