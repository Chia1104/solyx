import type * as z from "zod";

import { scheduledTaskDraftSchema } from "@solyx/core/schedule";
import type {
  CollectionJob,
  CollectionPlan,
  ScheduledTask,
} from "@solyx/core/schedule";

import { localeSchema } from "./ipc/settings.ts";

/** A task as a window saves it, answering in one of the app's own languages, as a message the user sends does. */
export const taskDraftSchema = scheduledTaskDraftSchema.extend({
  locale: localeSchema,
});

export type TaskDraft = z.infer<typeof taskDraftSchema>;

/** A scheduled task as the settings show it. */
export interface ScheduledTaskView extends ScheduledTask {
  /** Epoch ms of its next run while the app stays open; `null` while it is switched off or no day ahead takes it. */
  nextRunAt: number | null;
  /** Whether its last run is still going, one waiting for the user among them. */
  running: boolean;
}

/** When one of the app's own collections last ran and next will. */
export interface CollectionStatus {
  /** Epoch ms anything it covers was last collected, by it or for the agent; `null` before any. */
  lastAt: number | null;
  /** Epoch ms the first of what it covers is next due while the app stays open; `null` while it is switched off, covers nothing, or no day ahead takes it. */
  nextAt: number | null;
}

/** One of the app's own collections as the settings show it. */
export interface CollectionView extends CollectionStatus {
  job: CollectionJob;
  plan: CollectionPlan;
}
