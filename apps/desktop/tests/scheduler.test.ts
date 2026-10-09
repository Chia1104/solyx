import { trace } from "@opentelemetry/api";
import type { Span } from "@opentelemetry/api";
import { noop } from "es-toolkit";
import { afterEach, expect, test, vi } from "vite-plus/test";

import { createScheduler } from "../src/main/scheduler.ts";

const MINUTE_MS = 60 * 1000;

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

/** The scheduler's telemetry: passes trace nowhere and failures are only recorded. */
function telemetry() {
  return {
    tracer: trace.getTracer("test"),
    within: <T>(_span: Span, work: () => Promise<T>) => work(),
    diagnostics: { recovered: vi.fn(), report: vi.fn() },
  };
}

/** Lets the passes a tick started settle. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

function setup() {
  let now = 0;
  const diagnosed = telemetry();

  const scheduler = createScheduler({ telemetry: diagnosed, now: () => now });

  return {
    scheduler,
    diagnostics: diagnosed.diagnostics,
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

test("a failed pass is reported under its name and leaves the others going", async () => {
  const { scheduler, tickAt, diagnostics } = setup();
  const failure = new Error("feed offline");
  const failing = vi.fn(() => Promise.reject(failure));
  const other = vi.fn(async () => undefined);

  scheduler.register("Update check", { everyMs: MINUTE_MS, run: failing });
  scheduler.register("News collection", { everyMs: MINUTE_MS, run: other });

  await tickAt(0);

  expect(diagnostics.report).toHaveBeenCalledWith(failure, "scheduler.pass", {
    "solyx.work": "Update check",
  });
  expect(other).toHaveBeenCalledOnce();

  await tickAt(1);
  expect(failing).toHaveBeenCalledTimes(2);
});

test("the clock ticks a minute after start, then every minute, until stopped", async () => {
  vi.useFakeTimers();

  const scheduler = createScheduler({ telemetry: telemetry() });
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
