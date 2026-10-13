import { createHash } from "node:crypto";
import { createReadStream, existsSync, rmSync } from "node:fs";
import {
  cp,
  mkdir,
  mkdtemp,
  readdir,
  realpath,
  rm,
  stat,
} from "node:fs/promises";
import { dirname, join, relative } from "node:path";

import { isEqual, sumBy } from "es-toolkit";

import {
  BUNDLE_EXTENSION,
  readBundle,
  writeBundle,
} from "@solyx/backup/bundle";
import { expiredBackups } from "@solyx/backup/retention";
import { DEFAULT_REGION, awsEndpoint, createBucket } from "@solyx/backup/s3";
import type { Bucket, BucketOptions } from "@solyx/backup/s3";
import {
  snapshotDatabase,
  verifyAgentSnapshot,
  verifySnapshot,
} from "@solyx/db/snapshot";
import { errorMessage, isErrnoError } from "@solyx/utils/error";

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

import type { ScheduledWork } from "../../scheduler.ts";
import { endpointSchema } from "../settings/config-file.ts";
import type { ConfigFile } from "../settings/config-file.ts";
import type { SecretStore } from "../settings/secret-store.ts";
import type { Diagnostics } from "../telemetry/diagnostics.ts";

import {
  AGENT_DATABASE,
  DRIZZLE_DATABASES,
  databasePlace,
  filePlaces,
} from "./backup-places.ts";
import type { DataFolders } from "./backup-places.ts";
import { NEVER, createBackupState } from "./backup-state.ts";
import type { BackupLocation, BackupState } from "./backup-state.ts";
import { restorePaths, stageRestore } from "./staged-restore.ts";
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

/** A moment as a backup's object is named after it, such as `20261013T080000Z`, which sorts as time does. */
const stamp = (at: number) =>
  new Date(at).toISOString().replace(/[-:]|\.\d{3}/g, "");

const STAMP = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/;

/** The key of the backup an installation made at a moment, under the folder its bucket keeps them in. */
export const backupKey = (folder: string, installation: string, at: number) =>
  `${folder}/${installation}/${stamp(at)}${BUNDLE_EXTENSION}`;

/** Who made the backup at `key` and when, or `undefined` for an object in the folder that is not one. */
export function readBackupKey(folder: string, key: string) {
  if (!key.startsWith(`${folder}/`) || !key.endsWith(BUNDLE_EXTENSION)) {
    return undefined;
  }

  const [installation, name = "", ...deeper] = key
    .slice(folder.length + 1, -BUNDLE_EXTENSION.length)
    .split("/");

  // Only a name written as `stamp` writes it, since a date alone would parse as a moment too.
  if (!installation || deeper.length > 0 || !STAMP.test(name)) {
    return undefined;
  }

  const createdAt = Date.parse(name.replace(STAMP, "$1-$2-$3T$4:$5:$6Z"));

  if (Number.isNaN(createdAt)) return undefined;

  return { installation, createdAt };
}

export interface BackupsOptions {
  config: Pick<ConfigFile, "read" | "set">;
  secrets: Pick<SecretStore, "get" | "state" | "onChange">;
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
  /** @default the bucket over the network */
  openBucket?: (options: BucketOptions) => Bucket;
  now?: () => number;
}

/** A hash of every file under `folder` with its path, which is the same until one of them changes. */
async function digestOf(folder: string) {
  const hash = createHash("sha256");

  const files = (
    await readdir(folder, { recursive: true, withFileTypes: true })
  )
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
    .toSorted();

  for (const file of files) {
    hash.update(`${relative(folder, file)}\0`);

    for await (const chunk of createReadStream(file).iterator()) {
      hash.update(chunk);
    }
  }

  return hash.digest("hex");
}

/**
 * Backups of what the app keeps, in the bucket the user set up: each one object, sealed under the
 * user's passphrase before it leaves this computer. One thing goes on at a time, and a restore
 * only stages a backup for the next start, since the databases stay open until the app quits.
 */
export function createBackups({
  config,
  secrets,
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
  openBucket = createBucket,
  now = Date.now,
}: BackupsOptions): BackupApi & { work: ScheduledWork } {
  const outgoing = join(folders.dataDir, "backup");
  const paths = restorePaths(folders.dataDir);
  const state = createBackupState(join(folders.dataDir, "backup.json"));

  let activity: BackupActivity | null = null;
  // Why the last backup made on its own, or the thinning after one, failed, and when it did.
  let failure: { message: string; at: number } | null = null;

  // Left by a backup the app quit in the middle of.
  rmSync(outgoing, { recursive: true, force: true });

  function begin(next: BackupActivity) {
    if (activity) throw new Error(BUSY[activity]);

    activity = next;
    onChange();
  }

  function end(next: BackupActivity | null = null) {
    activity = next;
    onChange();
  }

  // A backup sealed under another passphrase is none the present one opens, so the next is made
  // whatever it would hold. Nothing of a passphrase is kept to tell by, only that it changed.
  secrets.onChange((secret) => {
    if (secret !== Secret.BackupPassphrase) return;

    state.write({ ...state.read(), checkedAt: null, digest: null });
  });

  /** Where backups go as the settings say now, or `null` while no bucket is named. */
  function where(): BackupLocation | null {
    const {
      endpoint,
      region = DEFAULT_REGION,
      bucket,
      prefix,
    } = config.read().backup;

    return bucket
      ? {
          endpoint: endpoint ?? awsEndpoint(region),
          region,
          bucket,
          folder: prefix ?? app,
        }
      : null;
  }

  /** What is remembered of the backups kept at `to`: of another bucket or folder, nothing. */
  function remembered(to: BackupLocation | null): BackupState {
    const saved = state.read();

    return isEqual(saved.location, to) ? saved : NEVER;
  }

  /** The bucket as the user set it up, the folder in it and the passphrase, or a refusal that says what is missing. */
  async function destination() {
    const to = where();

    const [accessKeyId, secretAccessKey, passphrase] = await Promise.all(
      SECRETS.map((secret) => secrets.get(secret))
    );

    if (!to || !accessKeyId || !secretAccessKey || !passphrase) {
      throw new Error(
        "Set the bucket, its access key and a passphrase before using backups"
      );
    }

    return {
      location: to,
      bucket: openBucket({
        endpoint: to.endpoint,
        region: to.region,
        bucket: to.bucket,
        accessKeyId,
        secretAccessKey,
      }),
      folder: to.folder,
      passphrase,
    };
  }

  /** Copies every place of a backup into `content`, each database as it stands at one moment. */
  async function collect(content: string) {
    for (const name of [...DRIZZLE_DATABASES, AGENT_DATABASE]) {
      const { part, path } = databasePlace(folders, name);

      await mkdir(dirname(join(content, part)), { recursive: true });
      await snapshotDatabase(path, join(content, part));
    }

    for (const { part, path } of filePlaces(folders)) {
      try {
        // What a link at the place points to, since a bundle packs no link and settings a person
        // keeps elsewhere are the app's all the same.
        await cp(await realpath(path), join(content, part), {
          recursive: true,
          verbatimSymlinks: true,
        });
      } catch (error) {
        // The user may have written no instructions or MCP servers, and no conversation a folder.
        if (!isErrnoError(error, "ENOENT")) throw error;
      }
    }
  }

  /** Refuses a backup unpacked into `content` that lacks a database, holds a damaged one or was made by a newer build. */
  function verify(content: string) {
    for (const name of [...DRIZZLE_DATABASES, AGENT_DATABASE]) {
      const file = join(content, databasePlace(folders, name).part);

      if (!existsSync(file)) {
        throw new Error(`The backup holds no ${name} database`);
      }

      if (name === AGENT_DATABASE) verifyAgentSnapshot(file);
      else verifySnapshot(file, join(migrations, name));
    }
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

  /**
   * Deletes this installation's backups that the retention no longer keeps, and counts the rest.
   * It reads only the installation's own folder and only objects named as its backups are, so
   * nothing else in the bucket is ever deleted, and it runs only after a backup went up, so the
   * newest is always kept.
   */
  async function thin(bucket: Bucket, folder: string) {
    const own = (await bucket.list(`${folder}/${installation()}/`)).flatMap(
      ({ key, bytes }) => {
        const made = readBackupKey(folder, key);

        return made ? [{ key, bytes, createdAt: made.createdAt }] : [];
      }
    );

    const expired = new Set(expiredBackups(own, timeZone()));

    for (const { key } of expired) await bucket.remove(key);

    const kept = own.filter((backup) => !expired.has(backup));

    return { count: kept.length, bytes: sumBy(kept, ({ bytes }) => bytes) };
  }

  type Destination = Awaited<ReturnType<typeof destination>>;

  /** A copy of every place of a backup, in a folder of its own, and where it is to go. */
  interface Copy {
    to: Destination;
    /** The folder the copy and what is made from it are in. */
    work: string;
    content: string;
    digest: string;
  }

  /** Runs `job` on a copy of what the app keeps now, with nothing else going on, and removes the copy after. */
  async function withCopy<Result>(
    job: (copy: Copy) => Promise<Result>
  ): Promise<Result> {
    begin(BackupActivity.BackingUp);

    try {
      const to = await destination();

      await mkdir(outgoing, { recursive: true });

      const work = await mkdtemp(join(outgoing, "bundle-"));

      try {
        const content = join(work, "content");

        await collect(content);

        return await job({
          to,
          work,
          content,
          digest: await digestOf(content),
        });
      } finally {
        await rm(work, { recursive: true, force: true });
      }
    } finally {
      end();
    }
  }

  /** Seals a copy and uploads it, then thins out the older backups. */
  async function upload({
    to: { location, bucket, folder, passphrase },
    work,
    content,
    digest,
  }: Copy): Promise<StoredBackup> {
    const file = join(work, "sealed");
    // To the second, as its key names it, so a listing reads the same moment back.
    const createdAt = Math.floor(now() / 1000) * 1000;
    const key = backupKey(folder, installation(), createdAt);

    await writeBundle({
      folder: content,
      file,
      passphrase,
      origin: { app, version, installation: installation(), createdAt },
    });
    await bucket.put(key, file);

    let { stored } = remembered(location);

    failure = null;

    try {
      stored = await thin(bucket, folder);
    } catch (error) {
      // The backup is up; only its older ones stay longer than they should.
      failure = { message: errorMessage(error), at: now() };
      diagnostics.recovered(error, "backup.thin");
    }

    state.write({
      location,
      checkedAt: now(),
      uploadedAt: createdAt,
      // Not of a backup the passphrase changed under as it went up, which the new one does not open.
      digest:
        (await secrets.get(Secret.BackupPassphrase)) === passphrase
          ? digest
          : null,
      stored,
    });

    return { key, createdAt, bytes: (await stat(file)).size, own: true };
  }

  const work: ScheduledWork = {
    everyMs: PASS_EVERY_MS,

    async run() {
      const { automatic, every } = config.read().backup;
      const at = now();

      if (!automatic || activity !== null) return;

      if (at - (remembered(where()).checkedAt ?? 0) < INTERVAL_MS[every]) {
        return;
      }

      if (failure && at - failure.at < RETRY_MS) return;

      if (!(await ready())) return;

      try {
        await withCopy(async (copy) => {
          const last = remembered(copy.to.location);

          // Nothing changed since the last backup, so another would only be a second copy of it.
          if (copy.digest === last.digest)
            state.write({ ...last, checkedAt: at });
          else await upload(copy);
        });
      } catch (error) {
        // A bucket out of reach is tried again; the backup tab says why meanwhile. The wait counts
        // from now, since an upload may go on for longer than the wait before it fails.
        failure = { message: errorMessage(error), at: now() };
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
      const { uploadedAt, stored } = remembered(where());

      return {
        ready: await ready(),
        activity,
        restoredFrom: restored?.createdAt ?? null,
        lastBackupAt: uploadedAt,
        stored,
        failure: failure?.message ?? null,
      };
    },

    backUp: () => withCopy(upload),

    async list() {
      const { bucket, folder } = await destination();
      const own = installation();

      return (await bucket.list(`${folder}/`))
        .flatMap(({ key, bytes }): StoredBackup[] => {
          const made = readBackupKey(folder, key);

          return made
            ? [
                {
                  key,
                  bytes,
                  createdAt: made.createdAt,
                  own: made.installation === own,
                },
              ]
            : [];
        })
        .toSorted((a, b) => b.createdAt - a.createdAt);
    },

    async restore(key) {
      begin(BackupActivity.Restoring);

      // Whatever an earlier restore left but the data it replaced, which goes only once this one is staged.
      const working = [
        paths.download,
        paths.staged,
        paths.pending,
        paths.cleared,
      ];

      try {
        const { bucket, folder, passphrase } = await destination();

        if (!readBackupKey(folder, key)) {
          throw new Error(`${key} is not a backup in ${folder}`);
        }

        for (const path of working) {
          await rm(path, { recursive: true, force: true });
        }

        await mkdir(paths.folder, { recursive: true });
        await bucket.get(key, paths.download);

        const { createdAt } = await readBundle({
          file: paths.download,
          folder: paths.staged,
          passphrase,
        });

        await rm(paths.download, { force: true });
        verify(paths.staged);
        await rm(paths.previous, { recursive: true, force: true });
        stageRestore(folders.dataDir, { key, createdAt });
      } catch (error) {
        for (const path of working) {
          await rm(path, { recursive: true, force: true });
        }

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
