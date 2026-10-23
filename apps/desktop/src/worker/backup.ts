// The thread a backup or a restore is made in, built as its own bundle since a worker starts from
// a file. It runs the one job it was started for, posts the answer and ends.
import { parentPort, workerData } from "node:worker_threads";

import {
  createBackupJobs,
  toJobFailure,
} from "../backend/modules/backup/backup-jobs.ts";

import { BackupJob } from "./backup-protocol.ts";
import type {
  BackupAnswers,
  BackupReply,
  BackupRequest,
} from "./backup-protocol.ts";

const jobs = createBackupJobs();

function run(request: BackupRequest): Promise<BackupAnswers[BackupJob]> {
  switch (request.job) {
    case BackupJob.BackUp:
      return jobs.backUp(request.options);

    case BackupJob.BackUpIfChanged:
      return jobs.backUpIfChanged(request.options);

    case BackupJob.List:
      return jobs.list(request.options);

    case BackupJob.Restore:
      return jobs.restore(request.options);
  }
}

// SAFETY: only the main process starts this thread, and it hands it nothing but a BackupRequest.
const request = workerData as BackupRequest;

let reply: BackupReply;

try {
  reply = { answer: await run(request) };
} catch (error) {
  reply = { failure: toJobFailure(error) };
}

parentPort?.postMessage(reply);
