import { Worker } from "node:worker_threads";
import type { ResourceLimits } from "node:worker_threads";

/**
 * Runs one job in a worker thread started from `entry` with `request`, which ends once it answers
 * or after `timeoutMs`: the event loop every window, the scheduler and the order desk share only
 * waits for it, and what the job held in memory goes with its thread. `job` names it in failures.
 */
export function runOnce<Request, Reply>(
  entry: URL,
  request: Request,
  {
    job,
    timeoutMs,
    resourceLimits,
  }: { job: string; timeoutMs: number; resourceLimits?: ResourceLimits }
): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const thread = new Worker(entry, { workerData: request, resourceLimits });

    const deadline = setTimeout(() => {
      reject(new Error(`The ${job} took too long`));
      void thread.terminate();
    }, timeoutMs);

    thread.once("message", resolve);
    thread.once("error", reject);
    // Too late to matter once the thread has answered, since a promise settles once.
    thread.once("exit", (code) => {
      clearTimeout(deadline);
      reject(
        new Error(
          `The ${job}'s thread ended with code ${code} before it answered`
        )
      );
    });
  });
}
