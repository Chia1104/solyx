import { CollectionJob } from "@solyx/core/schedule";
import type { CollectionPlan } from "@solyx/core/schedule";

import type {
  CollectionStatus,
  CollectionView,
} from "#shared/ipc/schedules.ts";

import type { ConfigFile } from "../settings/config-file.ts";

/** One of the app's own collections, as whichever module makes it. */
export interface Collector {
  status(): Promise<CollectionStatus>;
  /** Collects everything it covers now, whatever its plan says. */
  collectNow(): Promise<void>;
}

/**
 * The app's own collections in one place, so the settings show them beside the tasks the agent is
 * sent: each keeps its plan in the config file, where a hand edit applies as the settings page's
 * does, and its own module makes it.
 */
export function createCollections({
  config,
  collectors,
}: {
  config: Pick<ConfigFile, "read" | "set">;
  collectors: Record<CollectionJob, Collector>;
}) {
  return {
    list: (): Promise<CollectionView[]> =>
      Promise.all(
        Object.values(CollectionJob).map(async (job) => ({
          job,
          plan: config.read().collection[job],
          ...(await collectors[job].status()),
        }))
      ),

    set(job: CollectionJob, plan: CollectionPlan) {
      config.set(["collection", job], plan);
    },

    collectNow: (job: CollectionJob) => collectors[job].collectNow(),
  };
}

export type Collections = ReturnType<typeof createCollections>;
