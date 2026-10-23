import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, expect, test } from "vite-plus/test";

import { Market } from "@solyx/core/market";
import { openAgentStore } from "@solyx/db/agent";
import { openMemory } from "@solyx/db/memory";
import { openNews } from "@solyx/db/news";
import { openResearch } from "@solyx/db/research";
import { openUserData } from "@solyx/db/user";

import { startFakeS3 } from "../../backup/tests/fixtures/fake-s3.ts";
import type { FakeS3 } from "../../backup/tests/fixtures/fake-s3.ts";
import { createBackupThreads } from "../src/modules/backup/backup-threads.ts";
import {
  restorePaths,
  takeRestore,
} from "../src/modules/backup/staged-restore.ts";

const MIGRATIONS = fileURLToPath(
  new URL("../../db/migrations", import.meta.url)
);

// The thread's own entry, which the app builds into a file beside the main bundle.
const threads = createBackupThreads(
  new URL("../src/worker/backup.ts", import.meta.url)
);

const account = {
  bucket: "solyx-backups",
  accessKeyId: "AKIAIOSFODNN7EXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
  region: "us-east-1",
};

const TSMC = { market: Market.TW, symbol: "2330" };

const AT = Date.UTC(2026, 9, 13, 8);

const DESK = "3f2a8c1e-5b7d-4e9a-8c6f-1d2e3f4a5b6c";

const LAPTOP = "9b8a7c6d-1e2f-4a3b-9c4d-5e6f7a8b9c0d";

let directory: string;

let server: FakeS3;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "solyx-backup-threads-"));
  server = await startFakeS3(account);
});

afterEach(async () => {
  await server.close();
  await rm(directory, { recursive: true, force: true });
});

/** A computer's folders with the app's databases in them, the user's left open as the app has it. */
async function computer(name: string) {
  const folders = {
    dataDir: join(directory, name, "data"),
    configDir: join(directory, name, "config"),
    workspaces: join(directory, name, "data", "agent-workspaces"),
  };

  await mkdir(folders.dataDir, { recursive: true });
  await mkdir(folders.configDir, { recursive: true });
  await writeFile(join(folders.configDir, "config.json"), "{}\n");

  const user = () =>
    openUserData(
      join(folders.dataDir, "user.sqlite"),
      join(MIGRATIONS, "user")
    );

  const opened = user();

  openMemory(
    join(folders.dataDir, "memory.sqlite"),
    join(MIGRATIONS, "memory")
  ).close();
  openNews(
    join(folders.dataDir, "news.sqlite"),
    join(MIGRATIONS, "news")
  ).close();
  openResearch(
    join(folders.dataDir, "research.sqlite"),
    join(MIGRATIONS, "research")
  ).close();
  await openAgentStore(join(folders.dataDir, "agent.sqlite"));

  return { folders, opened, user };
}

const destination = () => ({
  ...account,
  endpoint: server.endpoint,
  folder: "solyx",
  passphrase: "correct horse battery staple",
});

test("a thread makes a backup, lists it and stages it on another computer", async () => {
  const desk = await computer("desk");
  const laptop = await computer("laptop");

  desk.opened.watchlist.add(TSMC);

  const job = {
    to: destination(),
    folders: desk.folders,
    app: "solyx",
    version: "1.2.3",
    installation: DESK,
    at: AT,
    timeZone: "Asia/Taipei",
  };

  const made = await threads.backUp(job);

  expect(made).toMatchObject({
    backup: {
      key: `solyx/${DESK}/20261013T080000Z.solyx-backup`,
      createdAt: AT,
      own: true,
    },
    stored: { count: 1, bytes: made.backup.bytes },
    thinning: null,
  });
  expect(server.objects.get(made.backup.key)?.length).toBe(made.backup.bytes);
  // The same thing a second time is left unmade, by what the first held.
  await expect(
    threads.backUpIfChanged({ ...job, at: AT + 1000, last: made.digest })
  ).resolves.toBeNull();
  await expect(
    threads.list({ to: destination(), installation: LAPTOP })
  ).resolves.toEqual([{ ...made.backup, own: false }]);

  await expect(
    threads.restore({
      to: destination(),
      folders: laptop.folders,
      migrations: MIGRATIONS,
      key: made.backup.key,
    })
  ).resolves.toEqual({ key: made.backup.key, createdAt: AT });

  laptop.opened.close();

  expect(takeRestore(laptop.folders)).toEqual({
    key: made.backup.key,
    createdAt: AT,
  });

  const restored = laptop.user();

  expect(restored.watchlist.list()).toEqual([TSMC]);
  restored.close();
  desk.opened.close();
});

test("a failure crosses from the thread with its message and what kind it was", async () => {
  const desk = await computer("desk");

  const refused = threads.backUp({
    to: { ...destination(), secretAccessKey: "another secret" },
    folders: desk.folders,
    app: "solyx",
    version: "1.2.3",
    installation: DESK,
    at: AT,
    timeZone: "Asia/Taipei",
  });

  await expect(refused).rejects.toMatchObject({
    message: `${server.host} answered 403 SignatureDoesNotMatch: The request signature we calculated does not match the signature you provided.`,
    name: "HTTPError",
    status: 403,
  });
  // The thread cleared what it had copied before it ended.
  await expect(readdir(join(desk.folders.dataDir, "backup"))).resolves.toEqual(
    []
  );
  await expect(
    threads.restore({
      to: destination(),
      folders: desk.folders,
      migrations: MIGRATIONS,
      key: `solyx/${DESK}/20261013T080000Z.solyx-backup`,
    })
  ).rejects.toThrow(`${server.host} answered 404 NoSuchKey`);
  expect(existsSync(restorePaths(desk.folders.dataDir).pending)).toBe(false);
  desk.opened.close();
});

test("a thread that cannot start fails the job rather than leaving it waiting", async () => {
  const missing = createBackupThreads(
    // fallow-ignore-next-line unresolved-import
    new URL("../src/worker/no-such-entry.ts", import.meta.url)
  );

  await expect(
    missing.list({ to: destination(), installation: DESK })
  ).rejects.toThrow();
});
