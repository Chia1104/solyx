import { isEqual, mapValues } from "es-toolkit";

import { CHANNEL_VOICE } from "@solyx/core/news";
import type { NewsData } from "@solyx/db/news";
import { DAY_MS } from "@solyx/utils/date";

import { RETENTION_DAYS } from "#shared/news.ts";

import type { ScheduledWork } from "../../scheduler.ts";
import type { ConfigFile } from "../settings/config-file.ts";
import type { Diagnostics } from "../telemetry/diagnostics.ts";

export interface NewsRetentionOptions {
  news: Pick<NewsData, "prune">;
  /** Holds how long each voice's news is kept, read before every pass. */
  config: Pick<ConfigFile, "read" | "onChange">;
  diagnostics: Pick<Diagnostics, "recovered">;
  /** @default Date.now */
  now?: () => number;
}

/**
 * Drops what each channel found once it is older than the user keeps its voice's news, in a pass
 * soon after the app starts, then each day it runs, and at once when the user changes how long.
 */
export function createNewsRetention({
  news,
  config,
  diagnostics,
  now = Date.now,
}: NewsRetentionOptions): ScheduledWork {
  const kept = () => config.read().news.kept;

  function prune() {
    const at = now();
    const retention = kept();

    news.prune(
      mapValues(CHANNEL_VOICE, (voice) => {
        const days = RETENTION_DAYS[retention[voice]];

        return days === null ? null : new Date(at - days * DAY_MS);
      })
    );
  }

  let followed = kept();

  config.onChange(() => {
    const next = kept();

    if (isEqual(next, followed)) return;

    followed = next;

    // A listener that throws would keep the config file's later listeners from hearing of it.
    try {
      prune();
    } catch (error) {
      diagnostics.recovered(error, "news.retention");
    }
  });

  return {
    everyMs: DAY_MS,

    async run() {
      prune();
    },
  };
}
