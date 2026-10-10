import { symbolKey } from "@solyx/core/market";
import type { SymbolRef } from "@solyx/core/market";
import { collectionDue, nextCollection } from "@solyx/core/schedule";
import type { CollectionPlan } from "@solyx/core/schedule";

import type { CollectionStatus } from "#shared/ipc/schedules.ts";

import type { ScheduledWork } from "../../scheduler.ts";
import type { ScheduleDays } from "../market/schedule-days.ts";
import type { Diagnostics } from "../telemetry/diagnostics.ts";

import type { News } from "./news.ts";

// Often enough that a plan shortened to hours, or a time of day, is followed soon after.
const PASS_EVERY_MS = 30 * 60 * 1000;

export interface NewsCollectorOptions {
  news: Pick<News, "refresh" | "lastCollected">;
  diagnostics: Pick<Diagnostics, "recovered">;
  /** The listings the user holds or watches, read before every pass. */
  listings: () => Promise<SymbolRef[]>;
  /** Read before every pass, so a changed plan applies without a restart. */
  plan: () => CollectionPlan;
  days: ScheduleDays;
  /** @default Date.now */
  now?: () => number;
}

/**
 * Refreshes the news of every listing the user holds or watches as the user's plan has it due
 * while the app runs, so the history behind the sentiment gauge and the overview's headlines grows
 * without the agent asking. A collection the agent made counts.
 */
export function createNewsCollector(options: NewsCollectorOptions) {
  const { news, now = Date.now } = options;

  /** Refreshes each listing `due` takes in turn, one at a time, so no source sees a burst. */
  async function collect(due: (last: Date | null) => boolean) {
    for (const symbol of await options.listings()) {
      try {
        await news.refresh(symbol, due);
      } catch (error) {
        options.diagnostics.recovered(error, "news.collect", {
          "solyx.listing": symbolKey(symbol),
        });
      }
    }
  }

  const work: ScheduledWork = {
    everyMs: PASS_EVERY_MS,

    async run() {
      const plan = options.plan();

      if (!plan.enabled) return;

      const trades = await options.days(plan.schedule);
      const at = now();

      await collect((last) =>
        collectionDue(plan, last?.getTime() ?? null, at, trades)
      );
    },
  };

  return {
    work,

    /** Collects every listing now, whatever the plan says. */
    collectNow: () => collect(() => true),

    /** When a followed listing was last collected, and when the first of them is next due. */
    async status(): Promise<CollectionStatus> {
      const plan = options.plan();
      const trades = await options.days(plan.schedule);
      const at = now();

      const collected = (await options.listings()).map(
        (symbol) => news.lastCollected(symbol)?.getTime() ?? null
      );

      const made = collected.flatMap((last) => last ?? []);

      const due = plan.enabled
        ? collected.flatMap(
            (last) => nextCollection(plan, last, at, trades) ?? []
          )
        : [];

      return {
        lastAt: made.length > 0 ? Math.max(...made) : null,
        nextAt: due.length > 0 ? Math.min(...due) : null,
      };
    },
  };
}

export type NewsCollector = ReturnType<typeof createNewsCollector>;
