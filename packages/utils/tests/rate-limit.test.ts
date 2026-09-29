import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";

import { createRateLimiter } from "../src/rate-limit.ts";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

function tracker() {
  const started: number[] = [];

  const task = (id: number) => async () => {
    started.push(id);

    return id;
  };

  return { started, task };
}

test("starts up to the limit at once and the rest as the window slides", async () => {
  const schedule = createRateLimiter({ limit: 2, windowMs: 1_000 });
  const { started, task } = tracker();

  const results = [1, 2, 3, 4, 5].map((id) => schedule(task(id)));

  expect(started).toEqual([1, 2]);

  await vi.advanceTimersByTimeAsync(999);

  expect(started).toEqual([1, 2]);

  await vi.advanceTimersByTimeAsync(1);

  expect(started).toEqual([1, 2, 3, 4]);

  await vi.advanceTimersByTimeAsync(1_000);

  expect(await Promise.all(results)).toEqual([1, 2, 3, 4, 5]);
});

test("a window counts from each start, not from the first", async () => {
  const schedule = createRateLimiter({ limit: 2, windowMs: 1_000 });
  const { started, task } = tracker();

  void schedule(task(1));
  await vi.advanceTimersByTimeAsync(600);
  void schedule(task(2));
  void schedule(task(3));
  void schedule(task(4));
  await vi.advanceTimersByTimeAsync(400);

  expect(started).toEqual([1, 2, 3]);

  await vi.advanceTimersByTimeAsync(600);

  expect(started).toEqual([1, 2, 3, 4]);
});

test("a failing task rejects its caller without holding up the others", async () => {
  const schedule = createRateLimiter({ limit: 1, windowMs: 1_000 });

  const failing = schedule(async () => {
    throw new Error("refused");
  });

  const next = schedule(async () => "next");

  await expect(failing).rejects.toThrow("refused");
  await vi.advanceTimersByTimeAsync(1_000);

  expect(await next).toBe("next");
});
