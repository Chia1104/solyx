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
}

export interface BackupApi {
  settings(): Promise<BackupSettings>;
  /** `null` goes back to the default. */
  set(setting: BackupSetting, value: string | null): Promise<void>;
  status(): Promise<BackupStatus>;
  /** Uploads a backup of what the app keeps now, sealed under the passphrase. */
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
  status: "backup:status",
  backUp: "backup:back-up",
  list: "backup:list",
  restore: "backup:restore",
} as const satisfies Record<keyof BackupApi, string>;

export const backupEvents = {
  onChanged: "backup:changed",
} as const satisfies Record<keyof BackupEvents, string>;
