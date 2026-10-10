import { SpanStatusCode } from "@opentelemetry/api";

import type { Telemetry } from "./modules/telemetry/telemetry.ts";

// A minute places each pass closely enough for work due every half hour or less often.
const TICK_MS = 60 * 1000;

// Lets the app finish starting before the first pass.
const FIRST_TICK_MS = 60 * 1000;

/** Work the main process does on its own while the app runs. */
export interface ScheduledWork {
  /** How long after a pass starts the next is due. */
  everyMs: number;
  /** One pass, which leaves alone whatever it finds not yet due within it. */
  run(): Promise<void>;
}

export interface SchedulerOptions {
  /**
   * Each pass is a trace of its own, under the name its work registered with, and what it logs
   * joins that trace.
   */
  telemetry: Pick<Telemetry, "tracer" | "within" | "diagnostics">;
  /** @default Date.now */
  now?: () => number;
}

interface Registration {
  work: ScheduledWork;
  /** When its last pass started; `null` until the first. */
  startedAt: number | null;
  running: boolean;
}

/**
 * The one clock for the main process's periodic work: on each tick it starts a pass of every
 * registered work that is due. A pass still going when its next is due is skipped rather than
 * queued, and a pass that fails is reported and leaves the others going. Timers sleep with the
 * computer, so the host ticks it again as the computer wakes.
 */
export function createScheduler({
  telemetry: { tracer, within, diagnostics },
  now = Date.now,
}: SchedulerOptions) {
  const registrations = new Map<string, Registration>();
  let timers: NodeJS.Timeout[] = [];

  function tick() {
    const at = now();

    for (const [name, registration] of registrations) {
      const { work, startedAt, running } = registration;

      if (running || (startedAt !== null && at - startedAt < work.everyMs))
        continue;

      registration.running = true;
      registration.startedAt = at;

      const span = tracer.startSpan(name);

      void within(span, async () => {
        try {
          await work.run();
        } catch (error) {
          span.setStatus({ code: SpanStatusCode.ERROR });
          diagnostics.report(error, "scheduler.pass", { "solyx.work": name });
        } finally {
          span.end();
          registration.running = false;
        }
      });
    }
  }

  return {
    /** Adds work under the name its failures are logged by; its first pass starts at the next tick. */
    register(name: string, work: ScheduledWork) {
      registrations.set(name, { work, startedAt: null, running: false });
    },

    tick,

    start() {
      timers = [setTimeout(tick, FIRST_TICK_MS), setInterval(tick, TICK_MS)];
    },

    stop() {
      for (const timer of timers) clearTimeout(timer);

      timers = [];
    },
  };
}

export type Scheduler = ReturnType<typeof createScheduler>;
