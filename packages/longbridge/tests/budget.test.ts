import { noop } from "es-toolkit";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";

import { createBudget } from "../src/budget.ts";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
});

afterEach(() => {
  vi.useRealTimers();
});

/** A task that stays out until `settle` is called, recording that it started. */
function held(started: string[], name: string) {
  let settle: () => void = noop;

  const task = () =>
    new Promise<void>((resolve) => {
      started.push(name);
      settle = resolve;
    });

  return { task, settle: () => settle() };
}

test("no more requests start within a window than it allows, the rest as the window slides", async () => {
  const budget = createBudget({ limit: 2, concurrency: 5, windowMs: 1000 });
  const started: string[] = [];

  for (const name of ["a", "b", "c"]) {
    void budget.run(null, async () => {
      started.push(name);
    });
  }

  await vi.advanceTimersByTimeAsync(0);
  expect(started).toEqual(["a", "b"]);

  await vi.advanceTimersByTimeAsync(999);
  expect(started).toEqual(["a", "b"]);

  await vi.advanceTimersByTimeAsync(1);
  expect(started).toEqual(["a", "b", "c"]);
});

test("no more wait for an answer at once than it allows, the next starting as one settles", async () => {
  const budget = createBudget({ limit: 10, concurrency: 2, windowMs: 1000 });
  const started: string[] = [];
  const first = held(started, "a");

  void budget.run(null, first.task);
  void budget.run(null, held(started, "b").task);
  void budget.run(null, held(started, "c").task);

  await vi.advanceTimersByTimeAsync(0);
  expect(started).toEqual(["a", "b"]);

  first.settle();
  await vi.advanceTimersByTimeAsync(0);
  expect(started).toEqual(["a", "b", "c"]);
});

test("a lane keeps to its own pace within the budget, and what waits on it lets other lanes go first", async () => {
  const budget = createBudget({ limit: 10, concurrency: 5, windowMs: 1000 });
  const slow = budget.lane(1);
  const started: string[] = [];

  const run = (lane: typeof slow | null, name: string) =>
    void budget.run(lane, async () => {
      started.push(name);
    });

  run(slow, "slow 1");
  run(slow, "slow 2");
  run(null, "other");

  await vi.advanceTimersByTimeAsync(0);
  expect(started).toEqual(["slow 1", "other"]);

  await vi.advanceTimersByTimeAsync(1000);
  expect(started).toEqual(["slow 1", "other", "slow 2"]);
});

test("a task's failure reaches its caller and frees its slot", async () => {
  const budget = createBudget({ limit: 10, concurrency: 1, windowMs: 1000 });

  await expect(
    budget.run(null, async () => {
      throw new Error("refused");
    })
  ).rejects.toThrow("refused");

  await expect(budget.run(null, async () => "next")).resolves.toBe("next");
});

test("a lane with a gap starts its requests that far apart, and a pause holds it back", async () => {
  const budget = createBudget({ limit: 10, concurrency: 5, windowMs: 1000 });
  const spaced = budget.lane(10, { gapMs: 200 });
  const started: number[] = [];

  const run = () =>
    budget.run(spaced, async () => {
      started.push(Date.now());
    });

  const start = Date.now();

  void run();
  void run();
  await vi.advanceTimersByTimeAsync(0);
  expect(started.map((at) => at - start)).toEqual([0]);

  await vi.advanceTimersByTimeAsync(200);
  expect(started.map((at) => at - start)).toEqual([0, 200]);

  budget.pause(spaced, 500);
  void run();
  await vi.advanceTimersByTimeAsync(499);
  expect(started).toHaveLength(2);

  await vi.advanceTimersByTimeAsync(1);
  expect(started.map((at) => at - start)).toEqual([0, 200, 700]);
});
