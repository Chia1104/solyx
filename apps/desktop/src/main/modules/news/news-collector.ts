import type { SymbolRef } from "@solyx/core/market";
import { errorMessage } from "@solyx/utils/error";

import type { News } from "./news.ts";

const HOUR_MS = 60 * 60 * 1000;

const CHECK_INTERVAL_MS = 30 * 60 * 1000;

// Lets the app finish starting before the first check.
const FIRST_CHECK_MS = 60 * 1000;

export interface NewsCollectorOptions {
  news: Pick<News, "refresh">;
  watchlist: () => SymbolRef[];
  /** Read before every check, so a changed setting applies without a restart; 0 stops collecting. */
  collectEveryHours: () => number;
}

/**
 * Refreshes the news of every watched listing at the interval the user set while the app runs, so
 * the history behind the sentiment gauge grows without the agent asking. A collection the agent
 * made counts.
 */
export function createNewsCollector(options: NewsCollectorOptions) {
  let checking = false;
  let timers: NodeJS.Timeout[] = [];

  /** Refreshes each listing in turn, one at a time, so no source sees a burst. */
  async function check() {
    const everyMs = options.collectEveryHours() * HOUR_MS;

    if (checking || everyMs === 0) return;

    checking = true;

    try {
      for (const symbol of options.watchlist()) {
        try {
          await options.news.refresh(symbol, everyMs);
        } catch (error) {
          console.error(
            `News collection for ${symbol.market} ${symbol.symbol} failed: ${errorMessage(error)}`
          );
        }
      }
    } finally {
      checking = false;
    }
  }

  return {
    check,

    start() {
      const run = () => void check().catch(console.error);

      timers = [
        setTimeout(run, FIRST_CHECK_MS),
        setInterval(run, CHECK_INTERVAL_MS),
      ];
    },

    stop() {
      for (const timer of timers) clearTimeout(timer);

      timers = [];
    },
  };
}
