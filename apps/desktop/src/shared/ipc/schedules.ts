import type { ScheduledTask, ScheduledTaskDraft } from "@solyx/core/schedule";

/** A scheduled task as the settings show it. */
export interface ScheduledTaskView extends ScheduledTask {
  /** Epoch ms of its next run while the app stays open; `null` while it is switched off or no day ahead takes it. */
  nextRunAt: number | null;
  /** Whether its last run is still going, one waiting for the user among them. */
  running: boolean;
}

export interface SchedulesApi {
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
  /** A task was saved or removed, or one of them ran. */
  onChanged(listener: () => void): () => void;
}

export const schedulesChannels = {
  list: "schedules:list",
  create: "schedules:create",
  update: "schedules:update",
  remove: "schedules:remove",
  runNow: "schedules:run-now",
} as const satisfies Record<keyof SchedulesApi, string>;

export const schedulesEvents = {
  onChanged: "schedules:changed",
} as const satisfies Record<keyof SchedulesEvents, string>;
