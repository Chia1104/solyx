import { expect, test, vi } from "vite-plus/test";

import type { AgentSession } from "@solyx/agent/wire";
import { ApprovalMode } from "@solyx/agent/wire";
import { ChangeKind } from "@solyx/core/changes";
import type { Change, ChangeScope } from "@solyx/core/changes";
import { Market } from "@solyx/core/market";
import { ScheduleApproval, ScheduleKind } from "@solyx/core/schedule";
import type {
  ScheduleStore,
  ScheduledTask,
  ScheduledTaskDraft,
} from "@solyx/core/schedule";
import { weekdays } from "@solyx/core/session";
import { MINUTE_MS, HOUR_MS } from "@solyx/utils/date";

import { createSchedules } from "../src/main/modules/schedules/schedules.ts";

const taipei = (time: string) => Date.parse(`${time}+08:00`);

// 2026-10-08 is a Thursday.
const START = taipei("2026-10-08T07:00:00");

const BRIEF: ScheduledTaskDraft = {
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
};

function memoryStore(): ScheduleStore {
  const tasks = new Map<string, ScheduledTask>();

  return {
    list: () => [...tasks.values()].map((task) => structuredClone(task)),
    get: (id) => structuredClone(tasks.get(id)),
    save: (task) => void tasks.set(task.id, structuredClone(task)),
    remove: (id) => void tasks.delete(id),
  };
}

function setup() {
  const clock = { now: START };
  const store = memoryStore();
  const going = new Set<string>();
  let sessions = 0;

  const runScheduled = vi.fn(
    async (
      _task: Pick<ScheduledTask, "id" | "prompt">,
      _changes?: readonly Change[]
    ): Promise<AgentSession> => {
      sessions += 1;

      const id = String(sessions);

      going.add(id);

      return {
        id,
        title: "",
        createdAt: clock.now,
        updatedAt: clock.now,
        approvalMode: ApprovalMode.Auto,
        model: null,
        thinking: null,
        schedule: null,
      };
    }
  );

  const diagnostics = { recovered: vi.fn() };
  const onChange = vi.fn();

  const changes = vi.fn(
    async (_since: number, _scope: ChangeScope): Promise<Change[]> => []
  );

  let ids = 0;

  const schedules = createSchedules({
    store,
    agent: { runScheduled, busy: async (id) => going.has(id) },
    days: async () => weekdays,
    changes,
    diagnostics,
    onChange,
    now: () => clock.now,
    createId: () => `task-${(ids += 1)}`,
  });

  return {
    schedules,
    store,
    clock,
    going,
    runScheduled,
    changes,
    diagnostics,
    onChange,
  };
}

test("a task runs once its time comes, in a conversation its last run names", async () => {
  const { schedules, store, clock, runScheduled, onChange } = setup();

  schedules.create(BRIEF);

  expect(await schedules.list()).toMatchObject([
    { id: "task-1", nextRunAt: taipei("2026-10-08T08:30:00"), running: false },
  ]);

  await schedules.work.run();

  expect(runScheduled).not.toHaveBeenCalled();

  clock.now = taipei("2026-10-08T08:30:30");
  onChange.mockClear();
  await schedules.work.run();

  expect(runScheduled).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ id: "task-1", prompt: "/watchlist-upkeep" }),
    []
  );
  expect(store.get("task-1")?.lastRun).toEqual({
    at: clock.now,
    sessionId: "1",
    failure: null,
    changes: [],
  });
  expect(onChange).toHaveBeenCalledOnce();

  clock.now += MINUTE_MS;
  await schedules.work.run();

  expect(runScheduled).toHaveBeenCalledOnce();
});

test("a task whose last run is still going is skipped, and one switched off never runs", async () => {
  const { schedules, clock, going, runScheduled } = setup();

  schedules.create({
    ...BRIEF,
    schedule: { kind: ScheduleKind.Interval, everyMinutes: 30 },
  });
  schedules.create({ ...BRIEF, name: "Off", enabled: false });

  clock.now = START + 30 * MINUTE_MS;
  await schedules.work.run();
  clock.now = taipei("2026-10-08T09:00:00");
  await schedules.work.run();

  expect(runScheduled).toHaveBeenCalledOnce();
  expect(await schedules.list()).toMatchObject([
    { name: "Morning brief", running: true },
    { name: "Off", nextRunAt: null },
  ]);
  await expect(schedules.runNow("task-1")).rejects.toThrow("still going");

  going.clear();
  await schedules.work.run();

  expect(runScheduled).toHaveBeenCalledTimes(2);
});

test("a run that could not start is kept as failed and waits for its next time", async () => {
  const { schedules, store, clock, runScheduled, diagnostics } = setup();
  const failure = new Error("No model is set up");

  schedules.create(BRIEF);
  runScheduled.mockRejectedValueOnce(failure);
  clock.now = taipei("2026-10-08T08:31:00");
  await schedules.work.run();

  expect(store.get("task-1")?.lastRun).toEqual({
    at: clock.now,
    sessionId: null,
    failure: "No model is set up",
    changes: [],
  });
  expect(diagnostics.recovered).toHaveBeenCalledWith(failure, "schedules.run", {
    "solyx.schedule": "task-1",
  });

  clock.now = taipei("2026-10-08T12:00:00");
  await schedules.work.run();

  expect(runScheduled).toHaveBeenCalledOnce();

  clock.now = taipei("2026-10-09T08:30:00");
  await schedules.work.run();

  expect(runScheduled).toHaveBeenCalledTimes(2);
});

test("saving a task again counts its next run from then, and running it now ignores its schedule", async () => {
  const { schedules, clock, runScheduled } = setup();

  schedules.create({ ...BRIEF, enabled: false });
  await schedules.runNow("task-1");

  expect(runScheduled).toHaveBeenCalledOnce();

  // Switched on after today's time, so today's is not made up for.
  clock.now = taipei("2026-10-08T09:00:00");
  schedules.update("task-1", BRIEF);
  await schedules.work.run();

  expect(runScheduled).toHaveBeenCalledOnce();
  expect(await schedules.list()).toMatchObject([
    { nextRunAt: taipei("2026-10-09T08:30:00") },
  ]);
  expect(() => schedules.update("gone", BRIEF)).toThrow("no longer exists");

  schedules.remove("task-1");

  expect(await schedules.list()).toEqual([]);
});

test("a task saved under an id its writer names is kept once, and saved again keeps its last run", async () => {
  const { schedules, store, clock, onChange } = setup();

  schedules.save("from-the-agent", BRIEF);
  await schedules.runNow("from-the-agent");

  clock.now += MINUTE_MS;
  schedules.save("from-the-agent", { ...BRIEF, name: "Brief" });

  expect(store.list()).toMatchObject([
    {
      id: "from-the-agent",
      name: "Brief",
      createdAt: START,
      updatedAt: START + MINUTE_MS,
      lastRun: { at: START, sessionId: "1" },
    },
  ]);
  expect(onChange).toHaveBeenCalledTimes(3);
});

test("a task that waits on a change runs on the slower pass, once something changed within its scope since it last ran, is told what and keeps it", async () => {
  const { schedules, store, clock, changes, runScheduled } = setup();

  const scope: ChangeScope = {
    kinds: [ChangeKind.EventPassed],
    listings: [{ market: Market.TW, symbol: "2330" }],
    themes: null,
  };

  const passed: Change = {
    kind: ChangeKind.EventPassed,
    symbol: { market: Market.TW, symbol: "2330" },
    date: "2026-10-07",
    label: "Earnings call",
  };

  schedules.create({
    ...BRIEF,
    schedule: {
      kind: ScheduleKind.OnChange,
      atMostEveryMinutes: 60,
      scope,
    },
  });

  clock.now = START + 2 * HOUR_MS;
  await schedules.work.run();
  await schedules.changeWork.run();

  expect(changes).toHaveBeenCalledExactlyOnceWith(START, scope);
  expect(runScheduled).not.toHaveBeenCalled();
  expect(await schedules.list()).toMatchObject([{ nextRunAt: null }]);

  changes.mockResolvedValue([passed]);
  // The clock's own pass leaves it alone.
  await schedules.work.run();

  expect(runScheduled).not.toHaveBeenCalled();

  await schedules.changeWork.run();

  expect(runScheduled).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ id: "task-1" }),
    [passed]
  );
  expect(store.get("task-1")?.lastRun?.changes).toEqual([passed]);

  // Within its shortest span nothing runs, whatever changed; after it, the changes count from the last run.
  clock.now += 30 * MINUTE_MS;
  await schedules.changeWork.run();

  expect(runScheduled).toHaveBeenCalledOnce();
  expect(changes).toHaveBeenLastCalledWith(START + 2 * HOUR_MS, scope);
});
