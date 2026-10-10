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
import { AgentToolName } from "../src/wire.ts";

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

function setup() {
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

  const { tools = [] } = createTaskTools({
    tasks: {
      list: async () => [...kept.values()],
      save,
      clock: () => ({ timeZone: "Asia/Taipei", locale: "zh-TW" }),
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

    return { text: contentText(result.content ?? []), details: result.details };
  }

  return { run, kept, save, asked };
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
