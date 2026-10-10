import type { Change } from "@solyx/core/changes";
import {
  ScheduleKind,
  countedFrom,
  isDue,
  nextRun,
} from "@solyx/core/schedule";
import type {
  ScheduleStore,
  ScheduledRun,
  ScheduledTask,
  ScheduledTaskDraft,
} from "@solyx/core/schedule";
import { weekdays } from "@solyx/core/session";
import type { TradingDays } from "@solyx/core/session";
import { errorMessage } from "@solyx/utils/error";

import type { ScheduledTaskView } from "#shared/ipc/schedules.ts";

import type { ScheduledWork } from "../../scheduler.ts";
import type { AgentService } from "../agent/agent-service.ts";
import type { TradingCalendar } from "../market/trading-calendar.ts";
import type { Diagnostics } from "../telemetry/diagnostics.ts";

// Each pass only looks for tasks that are due, so it follows the scheduler's own tick.
const PASS_EVERY_MS = 60 * 1000;

// Telling what changed reads the account, which a live broker answers over the network, so tasks
// that wait on a change are looked at only this often, as news collection reads it.
const CHANGE_PASS_EVERY_MS = 30 * 60 * 1000;

export interface SchedulesOptions {
  store: ScheduleStore;
  agent: Pick<AgentService, "runScheduled" | "busy">;
  tradingDays: TradingCalendar;
  /** What changed after `since`, epoch ms, in what the app keeps of the listings the user follows and of their themes. */
  changes: (since: number) => Promise<Change[]>;
  diagnostics: Pick<Diagnostics, "recovered">;
  /** Called after a task is saved or removed and after each run, so whoever shows them can refresh. */
  onChange: () => void;
  /** @default Date.now */
  now?: () => number;
  /** @default () => crypto.randomUUID() */
  createId?: () => string;
}

/**
 * The messages the user has the agent sent on its own while the app runs: each run starts a
 * conversation of its own, so what it did is read there. A task whose last run is still going,
 * as one waiting for the user is, is skipped rather than queued, and a run that could not start
 * is kept as failed and never tried again before its next time.
 */
export function createSchedules(options: SchedulesOptions) {
  const {
    store,
    agent,
    diagnostics,
    onChange,
    now = Date.now,
    createId = () => crypto.randomUUID(),
  } = options;

  /** The days the task's market trades; every weekday when it names none or its calendar cannot be read. */
  async function tradesOf({ schedule }: ScheduledTask): Promise<TradingDays> {
    const market =
      schedule.kind === ScheduleKind.FixedTime ? schedule.tradingDaysOf : null;

    if (market === null) return weekdays;

    try {
      return await options.tradingDays(market);
    } catch (error) {
      diagnostics.recovered(error, "schedules.trading-days", {
        "solyx.market": market,
      });

      return weekdays;
    }
  }

  const running = async ({ lastRun }: ScheduledTask) =>
    lastRun?.sessionId != null && (await agent.busy(lastRun.sessionId));

  async function run(task: ScheduledTask, changes: readonly Change[] = []) {
    const at = now();
    let lastRun: ScheduledRun;

    try {
      const session = await agent.runScheduled(task, changes);

      lastRun = { at, sessionId: session.id, failure: null };
    } catch (error) {
      diagnostics.recovered(error, "schedules.run", {
        "solyx.schedule": task.id,
      });
      lastRun = { at, sessionId: null, failure: errorMessage(error) };
    }

    // Read afresh, since the user may have saved or removed the task while the run started.
    const current = store.get(task.id);

    if (current) store.save({ ...current, lastRun });

    onChange();
  }

  function existing(id: string): ScheduledTask {
    const task = store.get(id);

    if (!task) throw new Error("That scheduled task no longer exists");

    return task;
  }

  const waitsOnChange = ({ schedule }: ScheduledTask) =>
    schedule.kind === ScheduleKind.OnChange;

  /** What changed since the task last ran, where it waits on that; nothing for a task the clock alone times. */
  const changesFor = async (task: ScheduledTask) =>
    waitsOnChange(task) ? options.changes(countedFrom(task)) : [];

  /** Starts each of `tasks` that is due, one after another, so a model's limit sees no burst. */
  async function pass(tasks: readonly ScheduledTask[]) {
    for (const task of tasks) {
      if (!task.enabled) continue;

      const changes = await changesFor(task);

      const due = isDue(task, now(), {
        trades: await tradesOf(task),
        changed: changes.length > 0,
      });

      if (due && !(await running(task))) await run(task, changes);
    }
  }

  const work: ScheduledWork = {
    everyMs: PASS_EVERY_MS,
    run: () => pass(store.list().filter((task) => !waitsOnChange(task))),
  };

  const changeWork: ScheduledWork = {
    everyMs: CHANGE_PASS_EVERY_MS,
    run: () => pass(store.list().filter(waitsOnChange)),
  };

  return {
    /** The pass over the tasks the clock times. */
    work,
    /** The slower pass over the tasks that wait on a change. */
    changeWork,

    list: (): Promise<ScheduledTaskView[]> =>
      Promise.all(
        store.list().map(async (task) => ({
          ...task,
          // What changed is not read for the list, so a task that waits on a change shows no time.
          nextRunAt: task.enabled
            ? nextRun(task, now(), {
                trades: await tradesOf(task),
                changed: false,
              })
            : null,
          running: await running(task),
        }))
      ),

    create(draft: ScheduledTaskDraft) {
      const at = now();

      store.save({
        ...draft,
        id: createId(),
        createdAt: at,
        updatedAt: at,
        lastRun: null,
      });
      onChange();
    },

    /** Saves the task as written again, so a time of day already past today waits for tomorrow's. */
    update(id: string, draft: ScheduledTaskDraft) {
      store.save({ ...existing(id), ...draft, updatedAt: now() });
      onChange();
    },

    remove(id: string) {
      store.remove(id);
      onChange();
    },

    /** Runs the task now, whatever its schedule says and whether or not it is switched on. */
    async runNow(id: string) {
      const task = existing(id);

      if (await running(task)) {
        throw new Error("Its last run is still going");
      }

      await run(task, await changesFor(task));
    },
  };
}

export type Schedules = ReturnType<typeof createSchedules>;
