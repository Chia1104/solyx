import { expect, test, vi } from "vite-plus/test";

import { NewsChannel } from "@solyx/core/news";
import type { NewsData } from "@solyx/db/news";

import { createNewsRetention } from "../src/main/modules/news/news-retention.ts";

test("a pass drops the press's news after 90 days and the crowd's after 30", async () => {
  const prune = vi.fn<NewsData["prune"]>(() => 0);

  const work = createNewsRetention({
    news: { prune },
    now: () => Date.parse("2026-10-16T00:00:00Z"),
  });

  await work.run();

  const press = new Date("2026-07-18T00:00:00Z");
  const crowd = new Date("2026-09-16T00:00:00Z");

  expect(prune).toHaveBeenCalledWith({
    [NewsChannel.Announcement]: press,
    [NewsChannel.Article]: press,
    [NewsChannel.Forum]: crowd,
    [NewsChannel.Social]: crowd,
  });
  expect(work.everyMs).toBe(24 * 60 * 60 * 1000);
});
