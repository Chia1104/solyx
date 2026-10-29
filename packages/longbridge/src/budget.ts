/** A kind of request with a pace of its own, such as one command of the quote server's. */
export interface Lane {
  /** Requests that may start within one window. */
  readonly limit: number;
  /** The least time between two of its starts, for a server that takes no burst of them. */
  readonly gapMs: number;
  /** When its requests in the window started, oldest first. */
  readonly starts: number[];
  /** Until when none of its requests may start, as the server asked after refusing one. */
  pausedUntil: number;
}

/** When `lane` lets its next request start at `at` or later; `at` itself while it is free. */
function laneFree(lane: Lane, at: number, windowMs: number): number {
  const last = lane.starts.at(-1);

  return Math.max(
    at,
    lane.pausedUntil,
    last === undefined ? at : last + lane.gapMs,
    lane.starts.length >= lane.limit ? lane.starts[0] + windowMs : at
  );
}

export interface BudgetOptions {
  /** Requests of every lane that may start within one window. */
  limit: number;
  /** Requests that may wait for their answer at once. */
  concurrency: number;
  windowMs: number;
  /** @default Date.now */
  now?: () => number;
}

interface Waiting {
  lane: Lane | null;
  start: () => void;
}

/**
 * One sign-in's share of what Longbridge takes from an account: so many requests a window and so
 * many waiting for an answer at once, whatever they go over, with each lane kept to its own pace
 * within it. A request waits in arrival order, but one held back only by its own lane's pace lets
 * the requests of other lanes behind it go first, and it counts against both paces as it goes out
 * rather than as it waits.
 */
export function createBudget({
  limit,
  concurrency,
  windowMs,
  now = Date.now,
}: BudgetOptions) {
  const starts: number[] = [];
  const waiting: Waiting[] = [];
  let running = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const forget = (kept: number[], at: number) => {
    while (kept.length > 0 && kept[0] <= at - windowMs) kept.shift();
  };

  function pump() {
    const at = now();

    forget(starts, at);

    for (let index = 0; index < waiting.length;) {
      if (running >= concurrency || starts.length >= limit) break;

      const { lane, start } = waiting[index];

      if (lane) forget(lane.starts, at);

      if (lane && laneFree(lane, at, windowMs) > at) {
        index += 1;
        continue;
      }

      waiting.splice(index, 1);
      starts.push(at);
      lane?.starts.push(at);
      running += 1;
      start();
    }

    clearTimeout(timer);
    timer = undefined;

    // A slot frees as a request settles, which pumps again; only a pace needs the clock.
    if (waiting.length === 0 || running >= concurrency) return;

    const next =
      starts.length >= limit
        ? starts[0] + windowMs
        : Math.min(
            ...waiting.flatMap(({ lane }) =>
              lane ? [laneFree(lane, at, windowMs)] : []
            )
          );

    if (Number.isFinite(next)) {
      timer = setTimeout(pump, Math.max(0, next - at));
    }
  }

  return {
    /** A lane that keeps to `limit` requests a window within the budget, each `gapMs` at least after the one before. */
    lane: (
      laneLimit: number,
      { gapMs = 0 }: { gapMs?: number } = {}
    ): Lane => ({
      limit: laneLimit,
      gapMs,
      starts: [],
      pausedUntil: 0,
    }),

    /** Holds every request of `lane` back for `ms`, as a server asks after refusing one. */
    pause(lane: Lane, ms: number) {
      lane.pausedUntil = Math.max(lane.pausedUntil, now() + ms);
      pump();
    },

    /** Runs `task` once the budget and `lane` let it go out, holding its slot until it settles. */
    run<T>(lane: Lane | null, task: () => Promise<T>): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        waiting.push({
          lane,
          start: () => {
            task()
              .then(resolve, reject)
              .finally(() => {
                running -= 1;
                pump();
              });
          },
        });

        pump();
      });
    },
  };
}
