import { existsSync, rmSync } from "node:fs";
import { cp, mkdir, mkdtemp, realpath, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  BUNDLE_EXTENSION,
  readBundle,
  writeBundle,
} from "@solyx/backup/bundle";
import { DEFAULT_REGION, awsEndpoint, createBucket } from "@solyx/backup/s3";
import type { Bucket, BucketOptions } from "@solyx/backup/s3";
import {
  snapshotDatabase,
  verifyAgentSnapshot,
  verifySnapshot,
} from "@solyx/db/snapshot";
import { isErrnoError } from "@solyx/utils/error";

import {
  BackupActivity,
  BackupSetting,
  backupBucketSchema,
  backupPrefixSchema,
  backupRegionSchema,
} from "#shared/ipc/backup.ts";
import type { BackupApi, StoredBackup } from "#shared/ipc/backup.ts";
import { Secret, SecretState } from "#shared/ipc/settings.ts";

import { endpointSchema } from "../settings/config-file.ts";
import type { ConfigFile } from "../settings/config-file.ts";
import type { SecretStore } from "../settings/secret-store.ts";

import {
  AGENT_DATABASE,
  DRIZZLE_DATABASES,
  databasePlace,
  filePlaces,
} from "./backup-places.ts";
import type { DataFolders } from "./backup-places.ts";
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
  secrets: Pick<SecretStore, "get" | "state">;
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
  /** Called whenever what `status` answers changes. */
  onChange: () => void;
  /** @default the bucket over the network */
  openBucket?: (options: BucketOptions) => Bucket;
  now?: () => number;
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
  onChange,
  openBucket = createBucket,
  now = Date.now,
}: BackupsOptions): BackupApi {
  const outgoing = join(folders.dataDir, "backup");
  const paths = restorePaths(folders.dataDir);

  let activity: BackupActivity | null = null;

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

  /** The bucket as the user set it up, the folder in it and the passphrase, or a refusal that says what is missing. */
  async function destination() {
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
      bucket: openBucket({
        endpoint: endpoint ?? awsEndpoint(region),
        region,
        bucket,
        accessKeyId,
        secretAccessKey,
      }),
      folder: prefix ?? app,
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

  return {
    async settings() {
      const { endpoint, region, bucket, prefix } = config.read().backup;

      return {
        endpoint: endpoint ?? null,
        region: region ?? null,
        bucket: bucket ?? null,
        prefix: prefix ?? null,
        defaults: { region: DEFAULT_REGION, prefix: app },
      };
    },

    async set(setting, value) {
      config.set(
        ["backup", setting],
        value === null ? undefined : SETTING_SCHEMAS[setting].parse(value)
      );
    },

    async status() {
      const states = await Promise.all(
        SECRETS.map((secret) => secrets.state(secret))
      );

      return {
        ready:
          config.read().backup.bucket !== undefined &&
          states.every((state) => state === SecretState.Saved),
        activity,
        restoredFrom: restored?.createdAt ?? null,
      };
    },

    async backUp() {
      begin(BackupActivity.BackingUp);

      try {
        const { bucket, folder, passphrase } = await destination();

        await mkdir(outgoing, { recursive: true });

        const work = await mkdtemp(join(outgoing, "bundle-"));

        try {
          const content = join(work, "content");
          const file = join(work, "sealed");
          // To the second, as its key names it, so a listing reads the same moment back.
          const createdAt = Math.floor(now() / 1000) * 1000;
          const key = backupKey(folder, installation(), createdAt);

          await collect(content);
          await writeBundle({
            folder: content,
            file,
            passphrase,
            origin: { app, version, installation: installation(), createdAt },
          });
          await bucket.put(key, file);

          return { key, createdAt, bytes: (await stat(file)).size, own: true };
        } finally {
          await rm(work, { recursive: true, force: true });
        }
      } finally {
        end();
      }
    },

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
