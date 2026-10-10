import { ScheduleKind, isDue, nextRun } from "@solyx/core/schedule";
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

export interface SchedulesOptions {
  store: ScheduleStore;
  agent: Pick<AgentService, "runScheduled" | "busy">;
  tradingDays: TradingCalendar;
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

  async function run(task: ScheduledTask) {
    const at = now();
    let lastRun: ScheduledRun;

    try {
      const session = await agent.runScheduled(task);

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

  const work: ScheduledWork = {
    everyMs: PASS_EVERY_MS,

    /** Starts each task that is due, one after another, so a model's limit sees no burst. */
    async run() {
      for (const task of store.list()) {
        if (
          task.enabled &&
          isDue(task, now(), await tradesOf(task)) &&
          !(await running(task))
        ) {
          await run(task);
        }
      }
    },
  };

  return {
    work,

    list: (): Promise<ScheduledTaskView[]> =>
      Promise.all(
        store.list().map(async (task) => ({
          ...task,
          nextRunAt: task.enabled
            ? nextRun(task, now(), await tradesOf(task))
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

      await run(task);
    },
  };
}

export type Schedules = ReturnType<typeof createSchedules>;
