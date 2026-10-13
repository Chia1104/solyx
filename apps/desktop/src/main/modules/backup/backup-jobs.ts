import { createHash } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
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

import { sumBy } from "es-toolkit";
import * as z from "zod";

import {
  BUNDLE_EXTENSION,
  readBundle,
  writeBundle,
} from "@solyx/backup/bundle";
import { expiredBackups } from "@solyx/backup/retention";
import { createBucket } from "@solyx/backup/s3";
import type { Bucket, BucketOptions } from "@solyx/backup/s3";
import {
  snapshotDatabase,
  verifyAgentSnapshot,
  verifySnapshot,
} from "@solyx/db/snapshot";
import { errorMessage, isErrnoError } from "@solyx/utils/error";

import type { StoredBackup } from "#shared/ipc/backup.ts";

import type {
  BackUpOptions,
  BackupDestination,
  BackupEngine,
  JobFailure,
  MadeBackup,
} from "../../../worker/backup-protocol.ts";

import {
  AGENT_DATABASE,
  DRIZZLE_DATABASES,
  databasePlace,
  filePlaces,
} from "./backup-places.ts";
import type { DataFolders } from "./backup-places.ts";
import { restorePaths, stageRestore } from "./staged-restore.ts";

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

// What kind of failure it was, read off whatever was thrown: a system error's code, or the status
// a server answered with, which ky keeps on the response.
const failureSchema = z.object({
  name: z.string().catch("Error"),
  code: z.string().optional().catch(undefined),
  status: z.number().optional().catch(undefined),
  response: z.object({ status: z.number() }).optional().catch(undefined),
});

/** A thrown value as it crosses to another thread, where an error keeps none of its own properties. */
export function toJobFailure(cause: unknown): JobFailure {
  const { name, code, status, response } = failureSchema
    .catch({ name: "Error" })
    .parse(cause);

  return {
    message: errorMessage(cause),
    name,
    code,
    status: status ?? response?.status,
  };
}

/** The failure as an error again, with what its kind was, which the diagnostics log in place of its message. */
export function fromJobFailure({ message, name, code, status }: JobFailure) {
  return Object.assign(new Error(message), { name, code, status });
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

/** Copies every place of a backup into `content`, each database as it stands at one moment. */
async function collect(folders: DataFolders, content: string) {
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

/** A copy of every place of a backup, in a folder of its own. */
interface Copy {
  /** The folder the copy and what is made from it are in. */
  work: string;
  content: string;
  digest: string;
}

/** Runs `job` on a copy of what the app keeps now, and removes the copy after. */
async function withCopy<Result>(
  folders: DataFolders,
  job: (copy: Copy) => Promise<Result>
): Promise<Result> {
  const outgoing = join(folders.dataDir, "backup");

  await mkdir(outgoing, { recursive: true });

  const work = await mkdtemp(join(outgoing, "bundle-"));

  try {
    const content = join(work, "content");

    await collect(folders, content);

    return await job({ work, content, digest: await digestOf(content) });
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

/**
 * The jobs of a backup and of a restore: everything that reads the databases, packs, seals and
 * speaks to the bucket. They hold nothing between calls and know nothing of Electron, so a worker
 * thread runs them in the app and a test runs them where it stands.
 */
export function createBackupJobs(
  openBucket: (options: BucketOptions) => Bucket = createBucket
): BackupEngine {
  const bucketOf = (to: BackupDestination) =>
    openBucket({
      endpoint: to.endpoint,
      region: to.region,
      bucket: to.bucket,
      accessKeyId: to.accessKeyId,
      secretAccessKey: to.secretAccessKey,
    });

  /**
   * Deletes the installation's backups that the retention no longer keeps, and counts the rest.
   * It reads only the installation's own folder and only objects named as its backups are, so
   * nothing else in the bucket is ever deleted, and it runs only after a backup went up, so the
   * newest is always kept.
   */
  async function thin(
    bucket: Bucket,
    { to: { folder }, installation, timeZone }: BackUpOptions
  ) {
    const own = (await bucket.list(`${folder}/${installation}/`)).flatMap(
      ({ key, bytes }) => {
        const made = readBackupKey(folder, key);

        return made ? [{ key, bytes, createdAt: made.createdAt }] : [];
      }
    );

    const expired = new Set(expiredBackups(own, timeZone));

    for (const { key } of expired) await bucket.remove(key);

    const kept = own.filter((backup) => !expired.has(backup));

    return { count: kept.length, bytes: sumBy(kept, ({ bytes }) => bytes) };
  }

  /** Seals a copy and uploads it, then thins out the older backups. */
  async function upload(
    options: BackUpOptions,
    { work, content, digest }: Copy
  ): Promise<MadeBackup> {
    const { to, app, version, installation } = options;
    const bucket = bucketOf(to);
    const file = join(work, "sealed");
    // To the second, as its key names it, so a listing reads the same moment back.
    const createdAt = Math.floor(options.at / 1000) * 1000;
    const key = backupKey(to.folder, installation, createdAt);

    await writeBundle({
      folder: content,
      file,
      passphrase: to.passphrase,
      origin: { app, version, installation, createdAt },
    });
    await bucket.put(key, file);

    const backup = {
      key,
      createdAt,
      bytes: (await stat(file)).size,
      own: true,
    };

    try {
      return {
        backup,
        digest,
        stored: await thin(bucket, options),
        thinning: null,
      };
    } catch (error) {
      // The backup is up; only its older ones stay longer than they should.
      return { backup, digest, stored: null, thinning: toJobFailure(error) };
    }
  }

  /** Refuses a backup unpacked into `content` that lacks a database, holds a damaged one or was made by a newer build. */
  function verify(folders: DataFolders, migrations: string, content: string) {
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
    backUp: (options) =>
      withCopy(options.folders, (copy) => upload(options, copy)),

    backUpIfChanged: (options) =>
      withCopy(options.folders, async (copy) =>
        // Nothing changed since the last backup, so another would only be a second copy of it.
        copy.digest === options.last ? null : upload(options, copy)
      ),

    async list({ to, installation }) {
      return (await bucketOf(to).list(`${to.folder}/`))
        .flatMap(({ key, bytes }): StoredBackup[] => {
          const made = readBackupKey(to.folder, key);

          return made
            ? [
                {
                  key,
                  bytes,
                  createdAt: made.createdAt,
                  own: made.installation === installation,
                },
              ]
            : [];
        })
        .toSorted((a, b) => b.createdAt - a.createdAt);
    },

    async restore({ to, folders, migrations, key }) {
      const paths = restorePaths(folders.dataDir);

      // Whatever an earlier restore left but the data it replaced, which goes only once this one is staged.
      const working = [
        paths.download,
        paths.staged,
        paths.pending,
        paths.cleared,
      ];

      if (!readBackupKey(to.folder, key)) {
        throw new Error(`${key} is not a backup in ${to.folder}`);
      }

      try {
        for (const path of working) {
          await rm(path, { recursive: true, force: true });
        }

        await mkdir(paths.folder, { recursive: true });
        await bucketOf(to).get(key, paths.download);

        const { createdAt } = await readBundle({
          file: paths.download,
          folder: paths.staged,
          passphrase: to.passphrase,
        });

        await rm(paths.download, { force: true });
        verify(folders, migrations, paths.staged);
        await rm(paths.previous, { recursive: true, force: true });
        stageRestore(folders.dataDir, { key, createdAt });

        return { key, createdAt };
      } catch (error) {
        for (const path of working) {
          await rm(path, { recursive: true, force: true });
        }

        throw error;
      }
    },
  };
}
