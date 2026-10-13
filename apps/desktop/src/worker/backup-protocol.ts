import type { StoredBackup } from "#shared/ipc/backup.ts";

import type { DataFolders } from "../main/modules/backup/backup-places.ts";
import type { BackupLocation } from "../main/modules/backup/backup-state.ts";
import type { StagedRestore } from "../main/modules/backup/staged-restore.ts";

/** The bucket as the user set it up, with the key that reaches it and the passphrase that seals what goes there. */
export interface BackupDestination extends BackupLocation {
  accessKeyId: string;
  secretAccessKey: string;
  passphrase: string;
}

export interface BackUpOptions {
  to: BackupDestination;
  folders: DataFolders;
  /** The app's name, which differs by channel. */
  app: string;
  version: string;
  installation: string;
  /** When the backup is made; its key keeps the second. */
  at: number;
  /** The user's own time zone, whose days and weeks say which older backups stay. */
  timeZone: string;
}

export interface BackUpIfChangedOptions extends BackUpOptions {
  /** What the last backup held, by its hash, or `null` when there was none. */
  last: string | null;
}

export interface ListBackupsOptions {
  to: BackupDestination;
  installation: string;
}

export interface RestoreOptions {
  to: BackupDestination;
  folders: DataFolders;
  /** The folder that holds each database's migrations, by the database's name. */
  migrations: string;
  /** The backup's key in the bucket. */
  key: string;
}

/** What went wrong in a job, as much of it as crosses to another thread: its message and what kind it was. */
export interface JobFailure {
  message: string;
  name: string;
  /** A system error's code, such as `ENOSPC`. */
  code?: string;
  /** The HTTP status the bucket's server answered with. */
  status?: number;
}

export interface MadeBackup {
  backup: StoredBackup;
  /** What it holds, by its hash, to tell later whether anything changed since. */
  digest: string;
  /** The installation's backups once the older ones were thinned out, or `null` when that failed. */
  stored: { count: number; bytes: number } | null;
  /** Why thinning failed, which leaves the backup made. */
  thinning: JobFailure | null;
}

/**
 * What makes, lists and restores backups. In the app each call is a job a worker thread of its own
 * runs, since packing and sealing would hold the main process's event loop.
 */
export interface BackupEngine {
  /** Uploads a backup of what the app keeps now, then thins out the installation's older ones. */
  backUp(options: BackUpOptions): Promise<MadeBackup>;
  /** The same, or `null` and nothing uploaded when the backup would hold what the last one held. */
  backUpIfChanged(options: BackUpIfChangedOptions): Promise<MadeBackup | null>;
  /** Every backup in the folder, newest first, whichever installation made it. */
  list(options: ListBackupsOptions): Promise<StoredBackup[]>;
  /** Downloads a backup, checks it whole and stages it for the app's next start. */
  restore(options: RestoreOptions): Promise<StagedRestore>;
}

/** A job's name, which is the engine's method that runs it. */
export const BackupJob = {
  BackUp: "backUp",
  BackUpIfChanged: "backUpIfChanged",
  List: "list",
  Restore: "restore",
} as const satisfies Record<string, keyof BackupEngine>;

export type BackupJob = (typeof BackupJob)[keyof typeof BackupJob];

export type BackupAnswers = {
  [Job in BackupJob]: Awaited<ReturnType<BackupEngine[Job]>>;
};

/** The job a thread is started for, handed to it as its `workerData`. */
export type BackupRequest = {
  [Job in BackupJob]: { job: Job; options: Parameters<BackupEngine[Job]>[0] };
}[BackupJob];

/** The one message a thread posts before it ends. */
export type BackupReply =
  | { answer: BackupAnswers[BackupJob] }
  | { failure: JobFailure };
