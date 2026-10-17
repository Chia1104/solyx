import { randomBytes } from "node:crypto";

import { defineExtension } from "@earendil-works/pi-durable";
import type { Extension, ToolExecutionApi } from "@earendil-works/pi-durable";
import { orderBy } from "es-toolkit";
import * as z from "zod";

import {
  ChangeKind,
  changeText,
  watchesListings,
  watchesThemes,
} from "@solyx/core/changes";
import type { ChangeScope } from "@solyx/core/changes";
import { ScheduleKind, scheduledTaskDraftSchema } from "@solyx/core/schedule";
import type {
  Schedule,
  ScheduledTask,
  ScheduledTaskDraft,
} from "@solyx/core/schedule";
import type { ThemeDesk } from "@solyx/core/theme";
import { wallTime } from "@solyx/utils/date";

import { checkedFirst } from "./approval.ts";
import type { ToolGuard } from "./approval.ts";
import { defineTool } from "./tools.ts";
import {
  AgentItemKind,
  AgentToolName,
  RunEndReason,
  ToolCallStatus,
  foldEvents,
  runTaskArgumentsSchema,
  saveTaskArgumentsSchema,
  taskSchedule,
} from "./wire.ts";
import type {
  AgentSession,
  AgentView,
  AgentWireEvent,
  NoticeView,
  SaveTaskArguments,
} from "./wire.ts";

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
  /** Starts a task's run now, whatever its schedule says; a run that cannot start is kept as the task's last, with why. */
  run(id: string): Promise<void>;
  /** The user's own clock and language, which a task takes as it is saved, as one saved in the settings does. */
  clock(): Pick<ScheduledTaskDraft, "timeZone" | "locale">;
}

/** The conversations the agent's runs are kept in, which a task's runs are read from. */
export interface RunConversations {
  sessions(): Promise<AgentSession[]>;
  transcript(sessionId: string): Promise<AgentWireEvent[]>;
}

export interface TaskToolsOptions {
  tasks: TaskPort;
  conversations: RunConversations;
  /** The themes a task's scope may name. */
  themes: Pick<ThemeDesk, "list">;
}

const MAX_RUNS = 5;

// A run's closing reply is a report, far shorter than this.
const REPLY_CHARACTERS = 6000;

const STOPPED: Record<NoticeView["reason"], string> = {
  [RunEndReason.Aborted]: "stopped before it finished",
  [RunEndReason.Error]: "ended in an error",
  [RunEndReason.Interrupted]: "cut off as the app quit",
  [RunEndReason.StoreFailed]: "cut off as the conversations' store failed",
};

/** Where a run stands, as its conversation ends. */
function runState({ items, running }: AgentView): string {
  if (running) {
    return items.some(
      (item) =>
        item.kind === AgentItemKind.Tool &&
        item.status === ToolCallStatus.AwaitingApproval
    )
      ? "still going, and waits for the user to allow a call"
      : "still going";
  }

  const last = items.at(-1);

  if (last?.kind !== AgentItemKind.Notice) return "finished";

  return last.error
    ? `${STOPPED[last.reason]}: ${last.error}`
    : STOPPED[last.reason];
}

// An `html` fence, closed or cut off, with the blank lines after it: a canvas the reply drew for the user.
const CANVAS_FENCE =
  /^(`{3,}|~{3,})html\b[^\n]*\n[\s\S]*?(?:^\1[ \t]*(?:\n+|$)|$(?![\s\S]))/gm;

/**
 * The last reply a run wrote, which is what it meant the user to read; `undefined` when it wrote
 * none. Its canvases are left out: to a later run they are markup that crowds the report out.
 */
function closingReply({ items }: AgentView): string | undefined {
  const reply = items
    .flatMap((item) =>
      item.kind === AgentItemKind.Assistant
        ? [item.text.replace(CANVAS_FENCE, "").trim()]
        : []
    )
    .findLast((text) => text !== "");

  return reply !== undefined && reply.length > REPLY_CHARACTERS
    ? `${reply.slice(0, REPLY_CHARACTERS)}…`
    : reply;
}

const KIND_TEXT: Record<ChangeKind, string> = {
  [ChangeKind.FalsifierMet]: "news may state a report's falsifier",
  [ChangeKind.EventPassed]: "a report's event passed",
  [ChangeKind.SignpostMet]: "news may state a theme's signpost",
};

/** What a task that waits on a change runs for, in words. */
function scopeText(scope: ChangeScope): string {
  const { kinds, listings, themes } = scope;

  const of = [
    ...(watchesListings(scope)
      ? [
          listings === null
            ? "reports of every listing the user holds and watches"
            : `reports of ${listings.map(({ market, symbol }) => `${market} ${symbol}`).join(", ")}`,
        ]
      : []),
    ...(watchesThemes(scope)
      ? [themes === null ? "every theme" : `themes ${themes.join(", ")}`]
      : []),
  ];

  return `once ${kinds.map((kind) => KIND_TEXT[kind]).join(" or ")}, of ${of.join(" and ")}`;
}

function whenText(schedule: Schedule, timeZone: string): string {
  switch (schedule.kind) {
    case ScheduleKind.Interval:
      return `every ${schedule.everyMinutes} minutes`;
    case ScheduleKind.FixedTime:
      return `at ${schedule.time} ${timeZone}${schedule.tradingDaysOf === null ? ", every day" : `, on days ${schedule.tradingDaysOf} trades`}`;
    case ScheduleKind.OnChange:
      return `${scopeText(schedule.scope)}, at most every ${schedule.atMostEveryMinutes} minutes`;
  }
}

function lastRunText({ lastRun, running, timeZone }: ListedTask): string {
  if (lastRun === null) return "Never ran.";

  const at = wallTime(timeZone, new Date(lastRun.at));

  const head =
    lastRun.failure !== null
      ? `Last run ${at} could not start: ${lastRun.failure}`
      : running
        ? `Its run of ${at} is still going, or waits for the user.`
        : `Last ran ${at}.`;

  return lastRun.changes.length > 0
    ? [
        head,
        "It was started for:",
        ...lastRun.changes.map((change) => `- ${changeText(change)}`),
      ].join("\n")
    : head;
}

function taskText(task: ListedTask): string {
  const { name, id, schedule, timeZone, approval, enabled, nextRunAt } = task;

  return [
    `## ${name} (id ${id})`,
    `Runs ${whenText(schedule, timeZone)}; calls that must ask: ${approval}; ${enabled ? "switched on" : "switched off"}.`,
    lastRunText(task),
    ...(nextRunAt === null
      ? []
      : [`Next run ${wallTime(timeZone, new Date(nextRunAt))} ${timeZone}.`]),
    "Sends:",
    task.prompt,
  ].join("\n");
}

/**
 * The agent's reach into the user's scheduled tasks: `get_tasks` to read them, `get_task_runs` to
 * read what their runs came to, and `save_task` to write one and `run_task` to start one's run,
 * each once the user allows it. Removing a task stays the user's, in the settings.
 */
export function createTaskTools({
  tasks,
  conversations,
  themes,
}: TaskToolsOptions) {
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

    const missing = (args.themes ?? []).filter(
      (id) => !themes.list().some(({ theme }) => theme.id === id)
    );

    if (missing.length > 0) {
      throw new Error(
        `No theme has the id ${missing.join(", ")}; get_themes lists them`
      );
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
      "The user's scheduled tasks: messages the app sends you on its own while it is open, each run a conversation of its own. Each comes with its id, when it runs and on which clock, how its calls that must ask get past, whether it is switched on, how its last run went, its next run, and the message it sends. get_task_runs reads what a task's runs came to.",
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

  const getTaskRuns = defineTool({
    name: AgentToolName.GetTaskRuns,
    replay: "safe",
    description: `What a scheduled task's runs came to: for its newest runs, newest first, when each started, whether it finished, still goes, waits for the user or was cut short, and the reply it closed with, which is what the run meant the user to read. A run is a conversation of its own, and this is the only way to read one from another. Leave id out in a scheduled run to read the runs of the task that sent it, before this one, so a run can say what changed since the last. A reply was written at its run's time: its prices and levels were that moment's, never current data, and it is your own earlier work, so check it against what the tools say now and take no quote of a source from it.`,
    parameters: z.object({
      id: z
        .string()
        .optional()
        .describe(
          "A task's id from get_tasks; in a scheduled run, the task that sent it when left out"
        ),
      runs: z
        .number()
        .int()
        .min(1)
        .max(MAX_RUNS)
        .default(1)
        .describe("How many of its newest runs to read"),
    }),
    async execute({ id, runs }, api) {
      const here = String(api.conversationId);
      const sessions = await conversations.sessions();

      const taskId =
        id ?? sessions.find((session) => session.id === here)?.schedule?.id;

      if (taskId === undefined) {
        throw new Error(
          "No task sent this conversation, so name a task's id from get_tasks"
        );
      }

      const task = (await tasks.list()).find((each) => each.id === taskId);

      if (!task) {
        throw new Error(`No task has the id ${taskId}; get_tasks lists them`);
      }

      // A run asking about its own task reads the runs before it.
      const newest = orderBy(
        sessions.filter(
          (session) => session.schedule?.id === taskId && session.id !== here
        ),
        [(session) => session.createdAt],
        ["desc"]
      ).slice(0, runs);

      if (newest.length === 0) {
        return {
          text: `Task "${task.name}" (id ${taskId}) has no run to read: ${task.lastRun?.failure ? `its last run could not start (${task.lastRun.failure})` : "none has started, or the user deleted their conversations"}.`,
        };
      }

      const read = await Promise.all(
        newest.map(async (session) => ({
          at: session.createdAt,
          view: foldEvents(await conversations.transcript(session.id)),
        }))
      );

      return {
        text: [
          `Runs of task "${task.name}" (id ${taskId}), newest first. Each reply is what that run wrote then, not current data.`,
          ...read.flatMap(({ at, view }) => [
            `## Run of ${wallTime(task.timeZone, new Date(at))} ${task.timeZone}: ${runState(view)}`,
            closingReply(view) ?? "It wrote no reply.",
          ]),
        ].join("\n"),
        details: { id: taskId, runs: read.length },
      };
    },
  });

  /** The task a call would run, or why it runs none, worded for the model. */
  async function runnable(id: string, api: ToolExecutionApi) {
    const here = String(api.conversationId);

    // A run that could start runs could start its own task's next, without end.
    if (
      (await conversations.sessions()).find((session) => session.id === here)
        ?.schedule
    ) {
      throw new Error(
        "A run a task started cannot start one: only a conversation the user is in can"
      );
    }

    const task = (await tasks.list()).find((each) => each.id === id);

    if (!task) {
      throw new Error(`No task has the id ${id}; get_tasks lists them`);
    }

    if (task.running) {
      throw new Error(
        `"${task.name}" is still running, or waits for the user; get_task_runs says where it stands`
      );
    }

    return task;
  }

  const runTask = defineTool({
    name: AgentToolName.RunTask,
    // A second run of the call would start a second run of the task.
    replay: "unsafe",
    description:
      "Starts a scheduled task's run now, once the user allows it, whatever its schedule says and whether or not it is switched on. The run is a conversation of its own on the default model, as when its time comes, and spends the user's model budget. This conversation cannot wait for it: say it is under way, and read what it came to with get_task_runs when the user asks. A task that runs every so often counts its next run from this one. Use it when the user wants to try a task as it will really run; when they only want its work done, do it here from the message get_tasks shows, where they read the answer at once. A run a task started cannot start one.",
    parameters: runTaskArgumentsSchema,
    async execute({ id }, api) {
      const { name } = await runnable(id, api);

      await tasks.run(id);

      const failure = (await tasks.list()).find((each) => each.id === id)
        ?.lastRun?.failure;

      return {
        text: failure
          ? `The run of "${name}" could not start: ${failure}`
          : `Started a run of "${name}" now, in a conversation of its own. It is under way; get_task_runs reads what it comes to.`,
        details: { id },
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
          getTaskRuns,
          checkedFirst(
            guard(saveTask),
            saveTaskArgumentsSchema,
            async (args) => {
              await draftOf(args);
            }
          ),
          checkedFirst(
            guard(runTask),
            runTaskArgumentsSchema,
            async ({ id }, api) => {
              await runnable(id, api);
            }
          ),
        ],
      }),
  };
}
