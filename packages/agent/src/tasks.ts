import { randomBytes } from "node:crypto";

import { defineExtension } from "@earendil-works/pi-durable";
import type { Extension } from "@earendil-works/pi-durable";
import * as z from "zod";

import { ScheduleKind, scheduledTaskDraftSchema } from "@solyx/core/schedule";
import type {
  Schedule,
  ScheduledTask,
  ScheduledTaskDraft,
} from "@solyx/core/schedule";

import { checkedFirst } from "./approval.ts";
import type { ToolGuard } from "./approval.ts";
import { defineTool } from "./tools.ts";
import {
  AgentToolName,
  saveTaskArgumentsSchema,
  taskSchedule,
} from "./wire.ts";
import type { SaveTaskArguments } from "./wire.ts";

/** A scheduled task with where its runs stand, as the host lists them. */
export interface ListedTask extends ScheduledTask {
  /** Epoch ms of its next run while the app stays open; `null` while it is switched off, waits on a change or no day ahead takes it. */
  nextRunAt: number | null;
  /** Whether its last run is still going, one waiting for the user among them. */
  running: boolean;
}

/** The host's scheduled tasks as the agent reads and writes them. */
export interface TaskPort {
  /** Oldest first. */
  list(): Promise<ListedTask[]>;
  /** Keeps a new task under `id`, or writes the one of that id again. */
  save(id: string, draft: ScheduledTaskDraft): void;
  /** The user's own clock and language, which a task takes as it is saved, as one saved in the settings does. */
  clock(): Pick<ScheduledTaskDraft, "timeZone" | "locale">;
}

export interface TaskToolsOptions {
  tasks: TaskPort;
}

/** A moment on a task's own clock, to the minute. */
const moment = (at: number, timeZone: string) =>
  Temporal.Instant.fromEpochMilliseconds(at)
    .toZonedDateTimeISO(timeZone)
    .toPlainDateTime()
    .toString({ smallestUnit: "minute" })
    .replace("T", " ");

function whenText(schedule: Schedule, timeZone: string): string {
  switch (schedule.kind) {
    case ScheduleKind.Interval:
      return `every ${schedule.everyMinutes} minutes`;
    case ScheduleKind.FixedTime:
      return `at ${schedule.time} ${timeZone}${schedule.tradingDaysOf === null ? ", every day" : `, on days ${schedule.tradingDaysOf} trades`}`;
    case ScheduleKind.OnChange:
      return `when something the app watches changed, at most every ${schedule.atMostEveryMinutes} minutes`;
  }
}

function lastRunText({ lastRun, running, timeZone }: ListedTask): string {
  if (lastRun === null) return "Never ran.";

  const at = moment(lastRun.at, timeZone);

  if (lastRun.failure !== null) {
    return `Last run ${at} could not start: ${lastRun.failure}`;
  }

  return running
    ? `Its run of ${at} is still going, or waits for the user.`
    : `Last ran ${at}.`;
}

function taskText(task: ListedTask): string {
  const { name, id, schedule, timeZone, approval, enabled, nextRunAt } = task;

  return [
    `## ${name} (id ${id})`,
    `Runs ${whenText(schedule, timeZone)}; calls that must ask: ${approval}; ${enabled ? "switched on" : "switched off"}.`,
    lastRunText(task),
    ...(nextRunAt === null
      ? []
      : [`Next run ${moment(nextRunAt, timeZone)} ${timeZone}.`]),
    "Sends:",
    task.prompt,
  ].join("\n");
}

/**
 * The agent's reach into the user's scheduled tasks: `get_tasks` to read them, and `save_task` to
 * write one once the user allows it. Removing a task stays the user's, in the settings.
 */
export function createTaskTools({ tasks }: TaskToolsOptions) {
  /** The task the arguments write, or why they write none, worded for the model. */
  async function draftOf(args: SaveTaskArguments): Promise<ScheduledTaskDraft> {
    if (
      args.id !== undefined &&
      !(await tasks.list()).some((task) => task.id === args.id)
    ) {
      throw new Error(
        `No task has the id ${args.id}; leave the id out to keep a new one`
      );
    }

    if (args.when === ScheduleKind.FixedTime && args.time === undefined) {
      throw new Error("A fixed-time task needs time, as HH:MM");
    }

    if (
      args.when !== ScheduleKind.FixedTime &&
      args.everyMinutes === undefined
    ) {
      throw new Error(`An ${args.when} task needs everyMinutes`);
    }

    const draft = scheduledTaskDraftSchema.safeParse({
      name: args.name,
      prompt: args.prompt,
      schedule: taskSchedule(args),
      ...tasks.clock(),
      approval: args.approval,
      enabled: args.enabled,
    });

    if (!draft.success) throw new Error(z.prettifyError(draft.error));

    return draft.data;
  }

  const getTasks = defineTool({
    name: AgentToolName.GetTasks,
    replay: "safe",
    description:
      "The user's scheduled tasks: messages the app sends you on its own while it is open, each run a conversation of its own. Each comes with its id, when it runs and on which clock, how its calls that must ask get past, whether it is switched on, how its last run went, its next run, and the message it sends.",
    parameters: z.object({}),
    async execute() {
      const listed = await tasks.list();

      return {
        text:
          listed.length === 0
            ? "The user has no scheduled tasks yet."
            : listed.map(taskText).join("\n\n"),
        details: { tasks: listed.length },
      };
    },
  });

  const saveTask = defineTool({
    name: AgentToolName.SaveTask,
    // A new task's id is kept with the call, so a call that runs again writes the same task.
    replay: "safe",
    description:
      "Keeps a scheduled task, or writes one again whole under its id, once the user allows it. The user sees exactly what you pass, so write it for them too. From then on the app sends you its message on its own while it is open, each run in a conversation of its own that knows nothing of this one and spends the user's model budget.",
    parameters: saveTaskArgumentsSchema,
    async execute(args, api, context) {
      const draft = await draftOf(args);

      const id =
        args.id ??
        (await api.memo("task-id", randomBytes(5).toString("hex"), context));

      tasks.save(id, draft);

      return {
        text: `${args.id ? "Wrote" : "Kept"} task ${id}, "${draft.name}": runs ${whenText(draft.schedule, draft.timeZone)}${draft.enabled ? "" : ", switched off"}.`,
        details: { id },
      };
    },
  });

  return {
    /** Reading rides every request; writing waits for the user through `guard`. */
    extension: (guard: ToolGuard): Extension =>
      defineExtension({
        name: "solyx-tasks",
        tools: [
          getTasks,
          checkedFirst(
            guard(saveTask),
            saveTaskArgumentsSchema,
            async (args) => {
              await draftOf(args);
            }
          ),
        ],
      }),
  };
}
