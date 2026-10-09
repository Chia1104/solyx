import { symbolKey } from "@solyx/core/market";
import type { SymbolRef } from "@solyx/core/market";

import type { ScheduledWork } from "../../scheduler.ts";
import type { Diagnostics } from "../telemetry/diagnostics.ts";

import type { News } from "./news.ts";

const HOUR_MS = 60 * 60 * 1000;

// Often enough that a setting shortened to hours is followed soon after.
const PASS_EVERY_MS = 30 * 60 * 1000;

export interface NewsCollectorOptions {
  news: Pick<News, "refresh">;
  diagnostics: Pick<Diagnostics, "recovered">;
  /** The listings the user holds or watches, read before every pass. */
  listings: () => Promise<SymbolRef[]>;
  /** Read before every pass, so a changed setting applies without a restart; 0 stops collecting. */
  collectEveryHours: () => number;
}

/**
 * Refreshes the news of every listing the user holds or watches at the interval the user set while
 * the app runs, so the history behind the sentiment gauge and the overview's headlines grows
 * without the agent asking. A collection the agent made counts.
 */
export function createNewsCollector(
  options: NewsCollectorOptions
): ScheduledWork {
  return {
    everyMs: PASS_EVERY_MS,

    /** Refreshes each listing in turn, one at a time, so no source sees a burst. */
    async run() {
      const everyMs = options.collectEveryHours() * HOUR_MS;

      if (everyMs === 0) return;

      for (const symbol of await options.listings()) {
        try {
          await options.news.refresh(symbol, everyMs);
        } catch (error) {
          options.diagnostics.recovered(error, "news.collect", {
            "solyx.listing": symbolKey(symbol),
          });
        }
      }
    },
  };
}
