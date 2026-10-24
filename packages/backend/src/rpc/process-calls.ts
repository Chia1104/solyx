/** The part of Electron's `UtilityProcess` a client needs besides its port, so tests stand in for it. */
export interface UtilityChild {
  on(event: "exit", listener: (code: number) => void): void;
  kill(): void;
}

/**
 * Calls into `child`, which `name` names in what a call fails with. A call it does not answer
 * within `timeoutMs` ends it, and an ended process fails every call still waiting and every later
 * one with why it ended.
 */
export function processCalls(
  child: UtilityChild,
  name: string,
  timeoutMs: number
) {
  // Aborts every call still waiting once the process is ended.
  const ending = new AbortController();

  let stopped: Error | undefined;

  function stop(reason: Error) {
    stopped ??= reason;
    ending.abort(stopped);
    child.kill();
  }

  child.on("exit", (code) =>
    stop(new Error(`${name} exited with code ${code}`))
  );

  async function call<T>(send: (signal: AbortSignal) => Promise<T>) {
    if (stopped) throw stopped;

    const timer = setTimeout(
      () =>
        stop(
          new Error(`${name} did not answer within ${timeoutMs / 1000} seconds`)
        ),
      timeoutMs
    );

    try {
      return await send(ending.signal);
    } catch (error) {
      // A call the process ended under fails with why it ended.
      throw stopped ?? error;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    call,
    /** Aborted once the process has ended. */
    signal: ending.signal,
    /** Why the process ended, once it has. */
    ended: () => stopped,
  };
}
