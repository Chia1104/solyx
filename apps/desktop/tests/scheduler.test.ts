import { noop } from "es-toolkit";
import { afterEach, expect, test, vi } from "vite-plus/test";

import { createScheduler } from "../src/main/scheduler.ts";

const MINUTE_MS = 60 * 1000;

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

/** Lets the passes a tick started settle. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

function setup() {
  let now = 0;

  const scheduler = createScheduler({ now: () => now });

  return {
    scheduler,
    /** Moves the clock, ticks and lets the passes settle. */
    async tickAt(minutes: number) {
      now = minutes * MINUTE_MS;
      scheduler.tick();
      await settle();
    },
  };
}

test("a pass starts at the first tick and again once its interval has passed", async () => {
  const { scheduler, tickAt } = setup();
  const run = vi.fn(async () => undefined);

  scheduler.register("work", { everyMs: 30 * MINUTE_MS, run });

  await tickAt(0);
  await tickAt(10);
  expect(run).toHaveBeenCalledOnce();

  await tickAt(30);
  expect(run).toHaveBeenCalledTimes(2);
});

test("a pass still going when the next is due is skipped, not queued", async () => {
  const { scheduler, tickAt } = setup();
  let finish = noop;

  const run = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      })
  );

  scheduler.register("work", { everyMs: 30 * MINUTE_MS, run });

  await tickAt(0);
  await tickAt(30);
  await tickAt(60);
  expect(run).toHaveBeenCalledOnce();

  finish();
  await settle();

  await tickAt(61);
  expect(run).toHaveBeenCalledTimes(2);
});

test("a failed pass is logged under its name and leaves the others going", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(noop);
  const { scheduler, tickAt } = setup();
  const failing = vi.fn(() => Promise.reject(new Error("feed offline")));
  const other = vi.fn(async () => undefined);

  scheduler.register("Update check", { everyMs: MINUTE_MS, run: failing });
  scheduler.register("News collection", { everyMs: MINUTE_MS, run: other });

  await tickAt(0);

  expect(error).toHaveBeenCalledWith("Update check failed: feed offline");
  expect(other).toHaveBeenCalledOnce();

  await tickAt(1);
  expect(failing).toHaveBeenCalledTimes(2);
});

test("the clock ticks a minute after start, then every minute, until stopped", async () => {
  vi.useFakeTimers();

  const scheduler = createScheduler();
  const run = vi.fn(async () => undefined);

  scheduler.register("work", { everyMs: MINUTE_MS, run });
  scheduler.start();

  await vi.advanceTimersByTimeAsync(MINUTE_MS - 1);
  expect(run).not.toHaveBeenCalled();

  await vi.advanceTimersByTimeAsync(1);
  expect(run).toHaveBeenCalledOnce();

  await vi.advanceTimersByTimeAsync(MINUTE_MS);
  expect(run).toHaveBeenCalledTimes(2);

  scheduler.stop();
  await vi.advanceTimersByTimeAsync(10 * MINUTE_MS);
  expect(run).toHaveBeenCalledTimes(2);
});
