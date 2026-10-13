import { rmSync } from "node:fs";
import { join } from "node:path";

import { DEFAULT_REGION, awsEndpoint } from "@solyx/backup/s3";
import { errorMessage } from "@solyx/utils/error";

import {
  BackupActivity,
  BackupInterval,
  BackupSetting,
  backupBucketSchema,
  backupPrefixSchema,
  backupRegionSchema,
} from "#shared/ipc/backup.ts";
import type { BackupApi, StoredBackup } from "#shared/ipc/backup.ts";
import { Secret, SecretState } from "#shared/ipc/settings.ts";

import type {
  BackUpOptions,
  BackupDestination,
  BackupEngine,
  MadeBackup,
} from "../../../worker/backup-protocol.ts";
import type { ScheduledWork } from "../../scheduler.ts";
import { endpointSchema } from "../settings/config-file.ts";
import type { ConfigFile } from "../settings/config-file.ts";
import type { SecretStore } from "../settings/secret-store.ts";
import type { Diagnostics } from "../telemetry/diagnostics.ts";

import { fromJobFailure } from "./backup-jobs.ts";
import type { DataFolders } from "./backup-places.ts";
import { createBackupState } from "./backup-state.ts";
import type { StagedRestore } from "./staged-restore.ts";

const SETTING_SCHEMAS = {
  [BackupSetting.Endpoint]: endpointSchema,
  [BackupSetting.Region]: backupRegionSchema,
  [BackupSetting.Bucket]: backupBucketSchema,
  [BackupSetting.Prefix]: backupPrefixSchema,
};

const SECRETS = [
  Secret.BackupAccessKeyId,
  Secret.BackupSecretAccessKey,
  Secret.BackupPassphrase,
];

const MINUTE_MS = 60 * 1000;

const INTERVAL_MS: Record<BackupInterval, number> = {
  [BackupInterval.QuarterHour]: 15 * MINUTE_MS,
  [BackupInterval.Hour]: 60 * MINUTE_MS,
  [BackupInterval.SixHours]: 6 * 60 * MINUTE_MS,
  [BackupInterval.Day]: 24 * 60 * MINUTE_MS,
};

// Each pass only looks whether a backup is due, which costs no request.
const PASS_EVERY_MS = MINUTE_MS;

// How long a backup that failed on its own waits before it is tried again, so a bucket that
// cannot be reached, as on a computer offline, is not asked every minute.
const RETRY_MS = 15 * MINUTE_MS;

const BUSY: Record<BackupActivity, string> = {
  [BackupActivity.BackingUp]: "A backup is being made",
  [BackupActivity.Restoring]: "A backup is being restored",
  [BackupActivity.Restarting]:
    "A restored backup is waiting for Solyx to restart",
};

export interface BackupsOptions {
  config: Pick<ConfigFile, "read" | "set">;
  secrets: Pick<SecretStore, "get" | "state">;
  /** What makes, lists and restores the backups: threads of their own in the app. */
  engine: BackupEngine;
  folders: DataFolders;
  /** The folder that holds each database's migrations, by the database's name. */
  migrations: string;
  /** The app's name, which names the default folder and differs by channel. */
  app: string;
  version: string;
  installation: () => string;
  /** The backup the app started on, if it was restored as it started. */
  restored: StagedRestore | null;
  /** Quits the app and starts it again. */
  restart: () => void;
  /** The user's own time zone, whose days and weeks say which backups are kept. */
  timeZone: () => string;
  diagnostics: Pick<Diagnostics, "recovered">;
  /** Called whenever what `status` answers changes. */
  onChange: () => void;
  now?: () => number;
}

/**
 * Backups of what the app keeps, in the bucket the user set up: each one object, sealed under the
 * user's passphrase before it leaves this computer. This side only decides: it reads the settings
 * and the secrets, keeps one thing going at a time and says when a backup is due, and hands the
 * work to the engine. A restore only stages a backup for the next start, since the databases stay
 * open until the app quits.
 */
export function createBackups({
  config,
  secrets,
  engine,
  folders,
  migrations,
  app,
  version,
  installation,
  restored,
  restart,
  timeZone,
  diagnostics,
  onChange,
  now = Date.now,
}: BackupsOptions): BackupApi & { work: ScheduledWork } {
  const state = createBackupState(join(folders.dataDir, "backup.json"));

  let activity: BackupActivity | null = null;
  // Why the last backup made on its own, or the thinning after one, failed, and when it did.
  let failure: { message: string; at: number } | null = null;

  // Left by a backup the app quit in the middle of.
  rmSync(join(folders.dataDir, "backup"), { recursive: true, force: true });

  function begin(next: BackupActivity) {
    if (activity) throw new Error(BUSY[activity]);

    activity = next;
    onChange();
  }

  function end(next: BackupActivity | null = null) {
    activity = next;
    onChange();
  }

  /** The bucket as the user set it up, its key and the passphrase, or a refusal that says what is missing. */
  async function destination(): Promise<BackupDestination> {
    const {
      endpoint,
      region = DEFAULT_REGION,
      bucket,
      prefix,
    } = config.read().backup;

    const [accessKeyId, secretAccessKey, passphrase] = await Promise.all(
      SECRETS.map((secret) => secrets.get(secret))
    );

    if (!bucket || !accessKeyId || !secretAccessKey || !passphrase) {
      throw new Error(
        "Set the bucket, its access key and a passphrase before using backups"
      );
    }

    return {
      endpoint: endpoint ?? awsEndpoint(region),
      region,
      bucket,
      accessKeyId,
      secretAccessKey,
      folder: prefix ?? app,
      passphrase,
    };
  }

  /** A bucket, both halves of its access key and a passphrase are all saved. */
  async function ready() {
    const states = await Promise.all(
      SECRETS.map((secret) => secrets.state(secret))
    );

    return (
      config.read().backup.bucket !== undefined &&
      states.every((saved) => saved === SecretState.Saved)
    );
  }

  /** Runs `job` on what a backup is made from and to, with nothing else going on. */
  async function backingUp<Result>(
    job: (options: BackUpOptions) => Promise<Result>
  ): Promise<Result> {
    begin(BackupActivity.BackingUp);

    try {
      return await job({
        to: await destination(),
        folders,
        app,
        version,
        installation: installation(),
        at: now(),
        timeZone: timeZone(),
      });
    } finally {
      end();
    }
  }

  /** Remembers a backup that went up, and what became of thinning out the older ones. */
  function keep({
    backup,
    digest,
    stored,
    thinning,
  }: MadeBackup): StoredBackup {
    failure = thinning && { message: thinning.message, at: now() };

    if (thinning) {
      diagnostics.recovered(fromJobFailure(thinning), "backup.thin");
    }

    state.write({
      checkedAt: now(),
      uploadedAt: backup.createdAt,
      digest,
      stored: stored ?? state.read().stored,
    });

    return backup;
  }

  const work: ScheduledWork = {
    everyMs: PASS_EVERY_MS,

    async run() {
      const { automatic, every } = config.read().backup;
      const at = now();

      if (!automatic || activity !== null) return;

      if (at - (state.read().checkedAt ?? 0) < INTERVAL_MS[every]) return;

      if (failure && at - failure.at < RETRY_MS) return;

      if (!(await ready())) return;

      try {
        const last = state.read();

        const made = await backingUp((options) =>
          engine.backUpIfChanged({ ...options, last: last.digest })
        );

        if (made) keep(made);
        // Having looked counts, so the next look waits a whole span again.
        else state.write({ ...last, checkedAt: at });
      } catch (error) {
        // A bucket out of reach is tried again; the backup tab says why meanwhile.
        failure = { message: errorMessage(error), at };
        diagnostics.recovered(error, "backup.pass");
        onChange();
      }
    },
  };

  return {
    work,

    async settings() {
      const { endpoint, region, bucket, prefix, automatic, every } =
        config.read().backup;

      return {
        endpoint: endpoint ?? null,
        region: region ?? null,
        bucket: bucket ?? null,
        prefix: prefix ?? null,
        defaults: { region: DEFAULT_REGION, prefix: app },
        automatic,
        every,
      };
    },

    async setAutomatic(automatic) {
      config.set(["backup", "automatic"], automatic);
    },

    async setEvery(every) {
      config.set(["backup", "every"], every);
    },

    async set(setting, value) {
      config.set(
        ["backup", setting],
        value === null ? undefined : SETTING_SCHEMAS[setting].parse(value)
      );
    },

    async status() {
      const { uploadedAt, stored } = state.read();

      return {
        ready: await ready(),
        activity,
        restoredFrom: restored?.createdAt ?? null,
        lastBackupAt: uploadedAt,
        stored,
        failure: failure?.message ?? null,
      };
    },

    backUp: async () => keep(await backingUp(engine.backUp)),

    list: async () =>
      engine.list({ to: await destination(), installation: installation() }),

    async restore(key) {
      begin(BackupActivity.Restoring);

      try {
        await engine.restore({
          to: await destination(),
          folders,
          migrations,
          key,
        });
      } catch (error) {
        end();

        throw error;
      }

      // Nothing else starts before the app has quit.
      end(BackupActivity.Restarting);
      restart();
    },
  };
}

export type Backups = ReturnType<typeof createBackups>;
