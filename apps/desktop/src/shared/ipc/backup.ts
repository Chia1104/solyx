import * as z from "zod";

/** The parts of where backups go that the config file keeps; the access key and the passphrase are secrets. */
export const BackupSetting = {
  Endpoint: "endpoint",
  Region: "region",
  Bucket: "bucket",
  Prefix: "prefix",
} as const;

export type BackupSetting = (typeof BackupSetting)[keyof typeof BackupSetting];

export const backupSettingSchema = z.enum(BackupSetting);

/** A region as S3 servers name them, such as `us-east-1`, `auto` or `us-west-004`. */
export const backupRegionSchema = z.string().regex(/^[a-z0-9-]{1,64}$/);

export const backupBucketSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{1,61}[A-Za-z0-9]$/);

/**
 * A folder in the bucket, as names between slashes. None starts with a dot, so the path is the
 * same wherever a URL is read, which would otherwise fold `..` away.
 */
export const backupPrefixSchema = z
  .string()
  .max(512)
  .regex(/^[A-Za-z0-9_-][A-Za-z0-9._-]*(\/[A-Za-z0-9_-][A-Za-z0-9._-]*)*$/);

/** How long after one backup the next is made on its own, while the app runs. */
export const BackupInterval = {
  QuarterHour: "15m",
  Hour: "1h",
  SixHours: "6h",
  Day: "1d",
} as const;

export type BackupInterval =
  (typeof BackupInterval)[keyof typeof BackupInterval];

export const backupIntervalSchema = z.enum(BackupInterval);

export interface BackupSettings {
  /** The S3 server's address; `null` is AWS's own for the region. */
  endpoint: string | null;
  /** `null` signs with `defaults.region`. */
  region: string | null;
  bucket: string | null;
  /** The folder in the bucket backups are kept under; `null` is `defaults.prefix`. */
  prefix: string | null;
  defaults: {
    region: string;
    /** Named after the app, so each channel keeps its own. */
    prefix: string;
  };
  /** Backups are made on their own while the app runs, once the destination is set up. */
  automatic: boolean;
  every: BackupInterval;
}

export const BackupActivity = {
  BackingUp: "backing-up",
  Restoring: "restoring",
  /** A backup is downloaded and checked, and the app is about to restart onto it. */
  Restarting: "restarting",
} as const;

export type BackupActivity =
  (typeof BackupActivity)[keyof typeof BackupActivity];

export interface StoredBackup {
  /** Its object's key in the bucket, which names it to `restore`. */
  key: string;
  createdAt: number;
  /** Sealed, as it is stored. */
  bytes: number;
  /** Made by this installation, rather than by another computer or channel that shares the folder. */
  own: boolean;
}

export interface BackupStatus {
  /** A bucket, both halves of its access key and a passphrase are all saved. */
  ready: boolean;
  activity: BackupActivity | null;
  /** When the backup was made that this computer's data was put back from as the app started. */
  restoredFrom: number | null;
  /** When this installation last uploaded a backup. */
  lastBackupAt: number | null;
  /** This installation's backups in the bucket as they were last counted, after the older ones were thinned out. */
  stored: { count: number; bytes: number } | null;
  /** Why the last backup made on its own, or the thinning after a backup, failed; `null` once one goes through. */
  failure: string | null;
}

export interface BackupApi {
  settings(): Promise<BackupSettings>;
  /** `null` goes back to the default. */
  set(setting: BackupSetting, value: string | null): Promise<void>;
  setAutomatic(automatic: boolean): Promise<void>;
  setEvery(every: BackupInterval): Promise<void>;
  status(): Promise<BackupStatus>;
  /** Uploads a backup of what the app keeps now, sealed under the passphrase, then thins out this installation's older ones. */
  backUp(): Promise<StoredBackup>;
  /** Every backup in the folder, newest first, whichever installation made it. */
  list(): Promise<StoredBackup[]>;
  /**
   * Downloads a backup and checks it whole, then restarts the app, which puts it in place of what
   * this computer holds as it starts. Keys and sign-ins are not part of a backup.
   */
  restore(key: string): Promise<void>;
}

/** Pushes from the main process; each subscription returns a function that stops listening. */
export interface BackupEvents {
  onChanged(listener: () => void): () => void;
}

export const backupChannels = {
  settings: "backup:settings",
  set: "backup:set",
  setAutomatic: "backup:set-automatic",
  setEvery: "backup:set-every",
  status: "backup:status",
  backUp: "backup:back-up",
  list: "backup:list",
  restore: "backup:restore",
} as const satisfies Record<keyof BackupApi, string>;

export const backupEvents = {
  onChanged: "backup:changed",
} as const satisfies Record<keyof BackupEvents, string>;
