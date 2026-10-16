import { mapValues } from "es-toolkit";

import { CHANNEL_VOICE } from "@solyx/core/news";
import type { NewsData } from "@solyx/db/news";

import { NEWS_KEPT_DAYS } from "#shared/news.ts";

import type { ScheduledWork } from "../../scheduler.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface NewsRetentionOptions {
  news: Pick<NewsData, "prune">;
  /** @default Date.now */
  now?: () => number;
}

/**
 * Drops what each channel found once it is older than `NEWS_KEPT_DAYS` keeps it, in a pass soon
 * after the app starts and then each day it runs.
 */
export function createNewsRetention({
  news,
  now = Date.now,
}: NewsRetentionOptions): ScheduledWork {
  return {
    everyMs: DAY_MS,

    async run() {
      const at = now();

      news.prune(
        mapValues(
          CHANNEL_VOICE,
          (voice) => new Date(at - NEWS_KEPT_DAYS[voice] * DAY_MS)
        )
      );
    },
  };
}
