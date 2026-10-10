import type {
  CollectionJob,
  CollectionPlan,
  ScheduledTask,
  ScheduledTaskDraft,
} from "@solyx/core/schedule";

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

export interface SchedulesApi {
  /** What the app collects on its own, in a fixed order. */
  collections(): Promise<CollectionView[]>;
  setCollection(job: CollectionJob, plan: CollectionPlan): Promise<void>;
  /** Collects now, whatever its plan says, and resolves once it is done. */
  collectNow(job: CollectionJob): Promise<void>;
  /** Oldest first. */
  list(): Promise<ScheduledTaskView[]>;
  create(draft: ScheduledTaskDraft): Promise<void>;
  /** Saves the task again, so its next run counts from now. */
  update(id: string, draft: ScheduledTaskDraft): Promise<void>;
  remove(id: string): Promise<void>;
  /** Starts a run now, whatever its schedule says; refused while its last run is still going. */
  runNow(id: string): Promise<void>;
}

/** Pushes from the main process; each subscription returns a function that stops listening. */
export interface SchedulesEvents {
  /** A task was saved or removed, or one of them ran, or a collection's plan changed. */
  onChanged(listener: () => void): () => void;
}

export const schedulesChannels = {
  collections: "schedules:collections",
  setCollection: "schedules:set-collection",
  collectNow: "schedules:collect-now",
  list: "schedules:list",
  create: "schedules:create",
  update: "schedules:update",
  remove: "schedules:remove",
  runNow: "schedules:run-now",
} as const satisfies Record<keyof SchedulesApi, string>;

export const schedulesEvents = {
  onChanged: "schedules:changed",
} as const satisfies Record<keyof SchedulesEvents, string>;
