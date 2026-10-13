import type { Context, JsonValue } from "@earendil-works/chord";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { contentText } from "@earendil-works/pi-ai";
import type {
  ToolExecutionApi,
  ToolRegistration,
} from "@earendil-works/pi-durable";
import { expect, test, vi } from "vite-plus/test";

import { Market } from "@solyx/core/market";
import { ScheduleApproval, ScheduleKind } from "@solyx/core/schedule";
import type { ScheduledTaskDraft } from "@solyx/core/schedule";

import { createTaskTools } from "../src/tasks.ts";
import type { ListedTask } from "../src/tasks.ts";
import {
  AgentEventType,
  AgentToolName,
  ApprovalMode,
  RunEndReason,
} from "../src/wire.ts";
import type { AgentSession, AgentWireEvent } from "../src/wire.ts";

type ToolArguments = Parameters<ToolRegistration["execute"]>[0];

const taipei = (time: string) => Date.parse(`${time}+08:00`);

const AT = taipei("2026-10-08T07:00:00");

const BRIEF = {
  name: "Morning brief",
  prompt: "/watchlist-upkeep",
  when: ScheduleKind.FixedTime,
  time: "08:30",
  tradingDaysOf: Market.TW,
};

/** A call's api as pi-durable hands it to a tool, keeping the call's memo between runs. */
function callApi(): ToolExecutionApi {
  const memos = new Map<string, JsonValue>();

  // SAFETY: the task tools read only the call's memo.
  return {
    conversationId: 7,
    callId: "call-1",
    async memo(name: string, candidate: JsonValue, _context: Context) {
      if (!memos.has(name)) memos.set(name, candidate);

      return memos.get(name);
    },
  } as ToolExecutionApi;
}

/** A conversation a task's run was started in, or one the user started when `task` is left out. */
function conversation(id: string, at: string, task?: string): AgentSession {
  return {
    id,
    title: "",
    createdAt: taipei(at),
    updatedAt: taipei(at),
    approvalMode: ApprovalMode.Auto,
    model: null,
    thinking: null,
    schedule: task === undefined ? null : { id: task, name: "Morning brief" },
  };
}

const said = (messageId: string, text: string): AgentWireEvent => ({
  type: AgentEventType.AssistantEnd,
  messageId,
  text,
  at: AT,
});

function setup(
  sessions: AgentSession[] = [],
  transcripts: Record<string, AgentWireEvent[]> = {}
) {
  const kept = new Map<string, ListedTask>();

  const save = vi.fn((id: string, draft: ScheduledTaskDraft) => {
    kept.set(id, {
      ...draft,
      id,
      createdAt: AT,
      updatedAt: AT,
      lastRun: null,
      nextRunAt: null,
      running: false,
    });
  });

  const asked = vi.fn();
  const api = callApi();

  // The host's own run, which keeps a run it could not start as the task's last.
  const start = vi.fn(async (id: string) => {
    const task = kept.get(id);

    if (task) {
      kept.set(id, {
        ...task,
        lastRun: { at: AT, sessionId: "9", failure: null },
        running: true,
      });
    }
  });

  const { tools = [] } = createTaskTools({
    tasks: {
      list: async () => [...kept.values()],
      save,
      run: start,
      clock: () => ({ timeZone: "Asia/Taipei", locale: "zh-TW" }),
    },
    conversations: {
      sessions: async () => sessions,
      transcript: async (id) => transcripts[id] ?? [],
    },
  }).extension((tool) => ({
    ...tool,
    async execute(params, toolApi, context) {
      asked(params);

      return tool.execute(params, toolApi, context);
    },
  }));

  async function run(name: AgentToolName, params: ToolArguments) {
    const tool = tools.find((candidate) => candidate.name === name);

    if (!tool) throw new Error(`No tool ${name}`);

    const result = await tool.execute(params, api, BACKGROUND_CONTEXT);

    return { text: contentText(result.output ?? []), details: result.details };
  }

  return { run, kept, save, asked, start };
}

test("a task is kept on the user's clock and runs its calls as auto unless told otherwise, and the call's second run writes the same one", async () => {
  const { run, kept, asked } = setup();

  const first = await run(AgentToolName.SaveTask, BRIEF);
  const again = await run(AgentToolName.SaveTask, BRIEF);

  expect(first.text).toMatch(
    /^Kept task \w+, "Morning brief": runs at 08:30 Asia\/Taipei, on days TW trades\.$/
  );
  expect(again.details).toEqual(first.details);
  expect([...kept.values()]).toMatchObject([
    {
      name: "Morning brief",
      prompt: "/watchlist-upkeep",
      schedule: {
        kind: ScheduleKind.FixedTime,
        time: "08:30",
        tradingDaysOf: Market.TW,
      },
      timeZone: "Asia/Taipei",
      locale: "zh-TW",
      approval: ScheduleApproval.Auto,
      enabled: true,
    },
  ]);
  expect(asked).toHaveBeenCalledTimes(2);
});

test("a task is written again under its id, switched off or set to wait on a change", async () => {
  const { run, kept } = setup();

  await run(AgentToolName.SaveTask, BRIEF);

  const [id] = kept.keys();

  expect(
    await run(AgentToolName.SaveTask, {
      id,
      name: "Watch for changes",
      prompt: "Read what changed and say what it means.",
      when: ScheduleKind.OnChange,
      everyMinutes: 120,
      approval: ScheduleApproval.Ask,
      enabled: false,
    })
  ).toMatchObject({
    text: `Wrote task ${id}, "Watch for changes": runs when something the app watches changed, at most every 120 minutes, switched off.`,
  });
  expect([...kept.values()]).toMatchObject([
    {
      id,
      schedule: { kind: ScheduleKind.OnChange, atMostEveryMinutes: 120 },
      approval: ScheduleApproval.Ask,
      enabled: false,
    },
  ]);
});

test("a task that cannot be kept is refused before the user is asked", async () => {
  const { run, save, asked } = setup();

  await expect(
    run(AgentToolName.SaveTask, { ...BRIEF, id: "gone" })
  ).rejects.toThrow("No task has the id gone");
  await expect(
    run(AgentToolName.SaveTask, { ...BRIEF, time: undefined })
  ).rejects.toThrow("A fixed-time task needs time");
  await expect(
    run(AgentToolName.SaveTask, { ...BRIEF, when: ScheduleKind.Interval })
  ).rejects.toThrow("An interval task needs everyMinutes");
  // Shorter than a task may recur.
  await expect(
    run(AgentToolName.SaveTask, {
      ...BRIEF,
      when: ScheduleKind.Interval,
      everyMinutes: 5,
    })
  ).rejects.toThrow("schedule.everyMinutes");
  await expect(
    run(AgentToolName.SaveTask, {
      ...BRIEF,
      prompt:
        "Read the account with key sk-ant-api03-abcdefghijklmnopqrstuvwxyz.",
    })
  ).rejects.toThrow("never holds a key");

  expect(asked).not.toHaveBeenCalled();
  expect(save).not.toHaveBeenCalled();
});

test("tasks read with when they run, how their last run went and what they send", async () => {
  const { run, kept } = setup();

  expect((await run(AgentToolName.GetTasks, {})).text).toBe(
    "The user has no scheduled tasks yet."
  );

  await run(AgentToolName.SaveTask, BRIEF);

  const [id] = kept.keys();
  const task = kept.get(id);

  if (!task) throw new Error("The task was not kept");

  kept.set(id, {
    ...task,
    lastRun: {
      at: taipei("2026-10-07T08:30:00"),
      sessionId: "12",
      failure: null,
    },
    nextRunAt: taipei("2026-10-08T08:30:00"),
  });

  const { text, details } = await run(AgentToolName.GetTasks, {});

  expect(text.split("\n")).toEqual([
    `## Morning brief (id ${id})`,
    "Runs at 08:30 Asia/Taipei, on days TW trades; calls that must ask: auto; switched on.",
    "Last ran 2026-10-07 08:30.",
    "Next run 2026-10-08 08:30 Asia/Taipei.",
    "Sends:",
    "/watchlist-upkeep",
  ]);
  expect(details).toEqual({ tasks: 1 });
});

test("a task's runs read newest first, each with where it stands and the reply it closed with", async () => {
  const { run, kept } = setup(
    [
      conversation("3", "2026-10-06T08:30:00", "other"),
      conversation("4", "2026-10-07T08:30:00"),
      conversation("5", "2026-10-07T08:30:00", "brief"),
      conversation("6", "2026-10-08T08:30:00", "brief"),
      conversation("8", "2026-10-09T08:30:00", "brief"),
    ],
    {
      "5": [
        { type: AgentEventType.RunStart },
        said("1", "Reading the watchlist."),
        said("2", "  台積電站上月線，其餘無變化。\n"),
        { type: AgentEventType.RunEnd, reason: RunEndReason.Done },
      ],
      "6": [
        { type: AgentEventType.RunStart },
        said("1", "外資連三買。"),
        {
          type: AgentEventType.RunEnd,
          reason: RunEndReason.Error,
          error: "The provider answered 529",
        },
      ],
      "8": [
        { type: AgentEventType.RunStart },
        {
          type: AgentEventType.ToolStart,
          toolCallId: "call-9",
          toolName: AgentToolName.SaveTheme,
          args: {},
        },
        { type: AgentEventType.ApprovalRequest, toolCallId: "call-9" },
      ],
    }
  );

  kept.set("brief", {
    name: "Morning brief",
    prompt: "/watchlist-upkeep",
    schedule: {
      kind: ScheduleKind.FixedTime,
      time: "08:30",
      tradingDaysOf: Market.TW,
    },
    timeZone: "Asia/Taipei",
    locale: "zh-TW",
    approval: ScheduleApproval.Auto,
    enabled: true,
    id: "brief",
    createdAt: AT,
    updatedAt: AT,
    lastRun: null,
    nextRunAt: null,
    running: true,
  });

  const { text, details } = await run(AgentToolName.GetTaskRuns, {
    id: "brief",
    runs: 5,
  });

  expect(text.split("\n")).toEqual([
    'Runs of task "Morning brief" (id brief), newest first. Each reply is what that run wrote then, not current data.',
    "## Run of 2026-10-09 08:30 Asia/Taipei: still going, and waits for the user to allow a call",
    "It wrote no reply.",
    "## Run of 2026-10-08 08:30 Asia/Taipei: ended in an error: The provider answered 529",
    "外資連三買。",
    "## Run of 2026-10-07 08:30 Asia/Taipei: finished",
    "台積電站上月線，其餘無變化。",
  ]);
  expect(details).toEqual({ id: "brief", runs: 3 });

  expect(
    (await run(AgentToolName.GetTaskRuns, { id: "brief" })).text.split("\n")
  ).toHaveLength(3);
});

test("a run's reply reads without the canvases it drew", async () => {
  const { run, kept } = setup(
    [conversation("5", "2026-10-07T08:30:00", "brief")],
    {
      "5": [
        { type: AgentEventType.RunStart },
        said(
          "1",
          [
            "台積電站上月線。",
            "",
            "```html",
            '<ol class="bars" style="--max: 3.1"><li style="--v: 3.1"><span>2330</span><b>+3.1%</b></li></ol>',
            "```",
            "",
            "其餘無變化。",
            "",
            "```html",
            '<ol class="shares"><li style="--v: 41">',
          ].join("\n")
        ),
        { type: AgentEventType.RunEnd, reason: RunEndReason.Done },
      ],
    }
  );

  kept.set("brief", {
    name: "Morning brief",
    prompt: "/watchlist-upkeep",
    schedule: {
      kind: ScheduleKind.FixedTime,
      time: "08:30",
      tradingDaysOf: Market.TW,
    },
    timeZone: "Asia/Taipei",
    locale: "zh-TW",
    approval: ScheduleApproval.Auto,
    enabled: true,
    id: "brief",
    createdAt: AT,
    updatedAt: AT,
    lastRun: null,
    nextRunAt: null,
    running: false,
  });

  const { text } = await run(AgentToolName.GetTaskRuns, { id: "brief" });

  expect(text.split("\n").slice(1)).toEqual([
    "## Run of 2026-10-07 08:30 Asia/Taipei: finished",
    "台積電站上月線。",
    "",
    "其餘無變化。",
  ]);
});

test("a scheduled run reads the runs before it without naming its task", async () => {
  const { run, save } = setup(
    [
      conversation("6", "2026-10-07T08:30:00", "brief"),
      // The call's own conversation, as `callApi` numbers it.
      conversation("7", "2026-10-08T08:30:00", "brief"),
    ],
    { "6": [said("1", "昨日結論。")] }
  );

  save("brief", {
    name: "Morning brief",
    prompt: "/watchlist-upkeep",
    schedule: { kind: ScheduleKind.Interval, everyMinutes: 60 },
    timeZone: "Asia/Taipei",
    locale: "zh-TW",
    approval: ScheduleApproval.Auto,
    enabled: true,
  });

  expect((await run(AgentToolName.GetTaskRuns, {})).text.split("\n")).toEqual([
    'Runs of task "Morning brief" (id brief), newest first. Each reply is what that run wrote then, not current data.',
    "## Run of 2026-10-07 08:30 Asia/Taipei: finished",
    "昨日結論。",
  ]);
});

test("runs that cannot be read say why", async () => {
  const { run, save } = setup([conversation("7", "2026-10-08T08:30:00")]);

  await expect(run(AgentToolName.GetTaskRuns, {})).rejects.toThrow(
    "No task sent this conversation"
  );
  await expect(run(AgentToolName.GetTaskRuns, { id: "gone" })).rejects.toThrow(
    "No task has the id gone"
  );

  save("brief", {
    name: "Morning brief",
    prompt: "/watchlist-upkeep",
    schedule: { kind: ScheduleKind.Interval, everyMinutes: 60 },
    timeZone: "Asia/Taipei",
    locale: "zh-TW",
    approval: ScheduleApproval.Auto,
    enabled: true,
  });

  expect((await run(AgentToolName.GetTaskRuns, { id: "brief" })).text).toBe(
    'Task "Morning brief" (id brief) has no run to read: none has started, or the user deleted their conversations.'
  );
});

const DRAFT: ScheduledTaskDraft = {
  name: "Morning brief",
  prompt: "/watchlist-upkeep",
  schedule: { kind: ScheduleKind.Interval, everyMinutes: 60 },
  timeZone: "Asia/Taipei",
  locale: "zh-TW",
  approval: ScheduleApproval.Auto,
  enabled: true,
};

test("a task's run starts once the user allows it, and one that could not start says why", async () => {
  // The call's own conversation is one the user started.
  const { run, save, asked, start, kept } = setup([
    conversation("7", "2026-10-08T07:00:00"),
  ]);

  save("brief", DRAFT);

  expect(await run(AgentToolName.RunTask, { id: "brief" })).toEqual({
    text: 'Started a run of "Morning brief" now, in a conversation of its own. It is under way; get_task_runs reads what it comes to.',
    details: { id: "brief" },
  });
  expect(asked).toHaveBeenCalledWith({ id: "brief" });
  expect(start).toHaveBeenCalledWith("brief");

  // Its run still goes, so another is refused before the user is asked.
  await expect(run(AgentToolName.RunTask, { id: "brief" })).rejects.toThrow(
    '"Morning brief" is still running'
  );
  expect(asked).toHaveBeenCalledOnce();

  const task = kept.get("brief");

  if (!task) throw new Error("The task is gone");

  kept.set("brief", { ...task, running: false });
  start.mockImplementationOnce(async (id) => {
    kept.set(id, {
      ...task,
      running: false,
      lastRun: {
        at: AT,
        sessionId: null,
        failure: "No model is set up",
      },
    });
  });

  expect((await run(AgentToolName.RunTask, { id: "brief" })).text).toBe(
    'The run of "Morning brief" could not start: No model is set up'
  );
});

test("a run a task started starts none, and a task that is not there is refused, before the user is asked", async () => {
  const scheduled = setup([conversation("7", "2026-10-08T08:30:00", "brief")]);

  scheduled.save("brief", DRAFT);

  await expect(
    scheduled.run(AgentToolName.RunTask, { id: "brief" })
  ).rejects.toThrow("A run a task started cannot start one");

  const attended = setup([conversation("7", "2026-10-08T07:00:00")]);

  await expect(
    attended.run(AgentToolName.RunTask, { id: "gone" })
  ).rejects.toThrow("No task has the id gone");

  for (const { asked, start } of [scheduled, attended]) {
    expect(asked).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
  }
});
