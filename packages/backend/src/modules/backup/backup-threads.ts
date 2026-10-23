import { Worker } from "node:worker_threads";

import { BackupJob } from "../../worker/backup-protocol.ts";
import type {
  BackupAnswers,
  BackupEngine,
  BackupReply,
  BackupRequest,
} from "../../worker/backup-protocol.ts";

import { fromJobFailure } from "./backup-jobs.ts";

/**
 * Runs each job of a backup or a restore in a worker thread of its own, started from `entry`,
 * which ends with its job, so nothing of it stays in memory between backups. The main process's
 * event loop, which every window, the scheduler and the order desk share, only waits for the
 * answer.
 */
export function createBackupThreads(entry: URL): BackupEngine {
  function run<Job extends BackupJob>(
    request: Extract<BackupRequest, { job: Job }>
  ): Promise<BackupAnswers[Job]> {
    return new Promise((resolve, reject) => {
      const thread = new Worker(entry, { workerData: request });

      thread.once("message", (reply: BackupReply) => {
        if ("failure" in reply) {
          reject(fromJobFailure(reply.failure));

          return;
        }

        // SAFETY: a thread answers the job it was started for with that job's own answer.
        resolve(reply.answer as BackupAnswers[Job]);
      });
      thread.once("error", reject);
      // Too late to matter once the thread has answered, since a promise settles once.
      thread.once("exit", (code) =>
        reject(
          new Error(
            `The backup thread ended with code ${code} before it answered`
          )
        )
      );
    });
  }

  return {
    backUp: (options) => run({ job: BackupJob.BackUp, options }),
    backUpIfChanged: (options) =>
      run({ job: BackupJob.BackUpIfChanged, options }),
    list: (options) => run({ job: BackupJob.List, options }),
    restore: (options) => run({ job: BackupJob.Restore, options }),
  };
}
