export interface RateLimit {
  /** Tasks that may start within one window. */
  limit: number;
  windowMs: number;
}

/**
 * Starts async tasks so that no more than `limit` start within any `windowMs`, holding the rest
 * in arrival order. The window slides, so it also keeps within limits counted per fixed minute.
 */
export function createRateLimiter({ limit, windowMs }: RateLimit) {
  const starts: number[] = [];
  const waiting: (() => void)[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;

  function pump() {
    const now = Date.now();

    while (starts.length > 0 && starts[0] <= now - windowMs) starts.shift();

    while (waiting.length > 0 && starts.length < limit) {
      starts.push(now);
      waiting.shift()?.();
    }

    if (waiting.length > 0 && timer === undefined) {
      timer = setTimeout(
        () => {
          timer = undefined;
          pump();
        },
        starts[0] + windowMs - now
      );
    }
  }

  return function schedule<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      waiting.push(() => {
        task().then(resolve, reject);
      });
      pump();
    });
  };
}
