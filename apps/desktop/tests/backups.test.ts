import { existsSync } from "node:fs";
import type * as NodeFsPromises from "node:fs/promises";
import {
  copyFile,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";

import type { Bucket } from "@solyx/backup/s3";
import { Market } from "@solyx/core/market";
import { openAgentStore } from "@solyx/db/agent";
import { openMemory } from "@solyx/db/memory";
import { openNews } from "@solyx/db/news";
import { openResearch } from "@solyx/db/research";
import { openUserData } from "@solyx/db/user";

import {
  BackupActivity,
  BackupInterval,
  BackupSetting,
} from "#shared/backup.ts";
import { Secret } from "#shared/ipc/settings.ts";

import {
  backupKey,
  createBackupJobs,
  readBackupKey,
} from "../src/main/modules/backup/backup-jobs.ts";
import { createBackups } from "../src/main/modules/backup/backups.ts";
import {
  RestoreFailure,
  restorePaths,
  settleRestore,
  takeRestore,
} from "../src/main/modules/backup/staged-restore.ts";
import { createConfigFile } from "../src/main/modules/settings/config-file.ts";
import { createSecretStore } from "../src/main/modules/settings/secret-store.ts";

import { fakeCipher } from "./fake-cipher.ts";

vi.mock("node:fs/promises", async (importOriginal) => {
  const fs = await importOriginal<typeof NodeFsPromises>();

  return { ...fs, cp: vi.fn(fs.cp) };
});

const fs = await vi.importActual<typeof NodeFsPromises>("node:fs/promises");

const MIGRATIONS = fileURLToPath(
  new URL("../../../packages/db/migrations", import.meta.url)
);

const TSMC = { market: Market.TW, symbol: "2330" };

const FOXCONN = { market: Market.TW, symbol: "2317" };

const AT = Date.UTC(2026, 9, 13, 8);

/** A bucket in memory, which two computers may share. */
function memoryBucket() {
  const objects = new Map<string, Buffer>();

  const bucket: Bucket = {
    async put(key, file) {
      objects.set(key, await readFile(file));
    },
    async get(key, file) {
      const found = objects.get(key);

      if (!found) throw new Error(`No object at ${key}`);

      await writeFile(file, found);
    },
    async remove(key) {
      objects.delete(key);
    },
    list: async (prefix) =>
      [...objects]
        .filter(([key]) => key.startsWith(prefix))
        .map(([key, body]) => ({ key, bytes: body.length })),
  };

  return { objects, bucket };
}

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "solyx-backups-"));
});

afterEach(async () => {
  vi.mocked(cp).mockImplementation(fs.cp);
  await rm(directory, { recursive: true, force: true });
});

/** A computer with the app's databases and files on it, set up to back up to `shared`. */
async function computer(
  name: string,
  shared: ReturnType<typeof memoryBucket>,
  passphrase = "correct horse battery staple",
  // The jobs run where the test stands, on the bucket in memory, as a thread runs them in the app.
  engine = createBackupJobs(() => shared.bucket)
) {
  const folders = {
    dataDir: join(directory, name, "data"),
    configDir: join(directory, name, "config"),
    workspaces: join(directory, name, "data", "agent-workspaces"),
  };

  await mkdir(folders.dataDir, { recursive: true });

  const config = createConfigFile(join(folders.configDir, "config.json"));

  const secrets = createSecretStore(
    join(folders.dataDir, "secrets.json"),
    fakeCipher().cipher
  );

  config.create();
  config.set(["backup", BackupSetting.Bucket], "solyx-backups");
  await secrets.save(Secret.BackupAccessKeyId, "AKIAIOSFODNN7EXAMPLE");
  await secrets.save(Secret.BackupSecretAccessKey, "not-a-real-secret");
  await secrets.save(Secret.BackupPassphrase, passphrase);

  const user = () =>
    openUserData(
      join(folders.dataDir, "user.sqlite"),
      join(MIGRATIONS, "user")
    );

  // Every database is made as the app starts, and stays open while a backup is made.
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

  const restart = vi.fn();
  const onChange = vi.fn();
  const diagnostics = { recovered: vi.fn() };
  // A moment between two seconds, which a backup's key does not keep.
  const clock = { now: AT + 852 };

  const backups = createBackups({
    config,
    secrets,
    folders,
    migrations: MIGRATIONS,
    app: "solyx",
    version: "1.2.3",
    installation: () => name,
    restored: null,
    restart,
    timeZone: () => "Asia/Taipei",
    diagnostics,
    onChange,
    engine,
    now: () => clock.now,
  });

  return {
    folders,
    config,
    secrets,
    backups,
    restart,
    onChange,
    diagnostics,
    clock,
    opened,
    user,
  };
}

test("a backup is one sealed object under its installation, named after its moment", async () => {
  const shared = memoryBucket();
  const desk = await computer("desk", shared);

  desk.opened.watchlist.add(TSMC);
  await writeFile(
    join(desk.folders.configDir, "mcp.json"),
    '{"mcpServers":{}}'
  );

  const made = await desk.backups.backUp();

  expect(made).toMatchObject({
    key: "solyx/desk/20261013T080000Z.solyx-backup",
    createdAt: AT,
    own: true,
  });
  expect([...shared.objects.keys()]).toEqual([made.key]);
  expect(shared.objects.get(made.key)?.length).toBe(made.bytes);
  // Nothing of what it holds can be read in it.
  expect(shared.objects.get(made.key)?.includes("mcpServers")).toBe(false);
  expect(shared.objects.get(made.key)?.includes("SQLite format")).toBe(false);
  // What it was made from is gone from the disk.
  expect(await readdir(join(desk.folders.dataDir, "backup"))).toEqual([]);
  await expect(desk.backups.status()).resolves.toEqual({
    ready: true,
    activity: null,
    restoredFrom: null,
    lastBackupAt: AT,
    stored: { count: 1, bytes: made.bytes },
    failure: null,
  });
});

test("every installation's backups are listed newest first, and others' things left out", async () => {
  const shared = memoryBucket();
  const desk = await computer("desk", shared);
  const laptop = await computer("laptop", shared);

  await desk.backups.backUp();
  laptop.clock.now = AT + 60 * 60 * 1000 + 3;
  await laptop.backups.backUp();
  shared.objects.set("solyx/desk/notes.txt", Buffer.from("not a backup"));
  shared.objects.set(
    "elsewhere/desk/20261013T080000Z.solyx-backup",
    Buffer.from("another folder's")
  );

  await expect(laptop.backups.list()).resolves.toMatchObject([
    {
      key: "solyx/laptop/20261013T090000Z.solyx-backup",
      createdAt: AT + 60 * 60 * 1000,
      own: true,
    },
    {
      key: "solyx/desk/20261013T080000Z.solyx-backup",
      createdAt: AT,
      own: false,
    },
  ]);
});

test("a restore puts a backup in place as the app next starts, and keeps what was there", async () => {
  const shared = memoryBucket();
  const desk = await computer("desk", shared);
  const laptop = await computer("laptop", shared);

  desk.opened.watchlist.add(TSMC);
  await mkdir(join(desk.folders.configDir, "skills", "ladder"), {
    recursive: true,
  });
  await writeFile(
    join(desk.folders.configDir, "skills", "ladder", "SKILL.md"),
    "# 分批進場\n"
  );
  await mkdir(join(desk.folders.workspaces, "conversation-1"), {
    recursive: true,
  });
  await writeFile(
    join(desk.folders.workspaces, "conversation-1", "notes.txt"),
    "kept by a shell command"
  );
  desk.config.set(["tray", "show"], false);

  const { key } = await desk.backups.backUp();

  // The other computer has things of its own, some of which the backup has no place for.
  laptop.opened.watchlist.add(FOXCONN);
  await writeFile(join(laptop.folders.configDir, "AGENTS.md"), "laptop only");

  await laptop.backups.restore(key);

  expect(laptop.restart).toHaveBeenCalledOnce();
  // Nothing moves while the app that asked still has its files open.
  expect(laptop.opened.watchlist.list()).toEqual([FOXCONN]);
  await expect(laptop.backups.status()).resolves.toMatchObject({
    activity: BackupActivity.Restarting,
  });
  await expect(laptop.backups.backUp()).rejects.toThrow(
    "A restored backup is waiting for Solyx to restart"
  );

  laptop.opened.close();

  expect(takeRestore(laptop.folders)).toEqual({ key, createdAt: AT });

  const restored = laptop.user();

  expect(restored.watchlist.list()).toEqual([TSMC]);
  restored.close();
  expect(laptop.config.read().tray.show).toBe(false);
  expect(
    await readFile(
      join(laptop.folders.configDir, "skills", "ladder", "SKILL.md"),
      "utf8"
    )
  ).toBe("# 分批進場\n");
  expect(
    await readFile(
      join(laptop.folders.workspaces, "conversation-1", "notes.txt"),
      "utf8"
    )
  ).toBe("kept by a shell command");
  // The backup held no instructions, so the laptop's own are not left in force.
  expect(existsSync(join(laptop.folders.configDir, "AGENTS.md"))).toBe(false);
  // Secrets stay this computer's.
  await expect(laptop.secrets.get(Secret.BackupPassphrase)).resolves.toBe(
    "correct horse battery staple"
  );

  const { previous, staged, pending } = restorePaths(laptop.folders.dataDir);

  expect(await readFile(join(previous, "config", "AGENTS.md"), "utf8")).toBe(
    "laptop only"
  );

  const kept = openUserData(
    join(previous, "databases", "user.sqlite"),
    join(MIGRATIONS, "user")
  );

  expect(kept.watchlist.list()).toEqual([FOXCONN]);
  kept.close();
  expect(existsSync(staged)).toBe(false);
  expect(existsSync(pending)).toBe(false);

  // The restore is told to whoever starts until it is settled, and applied only once.
  expect(takeRestore(laptop.folders)).toEqual({ key, createdAt: AT });
  settleRestore(laptop.folders.dataDir);
  expect(takeRestore(laptop.folders)).toBeNull();
});

test("a setting kept through a link is backed up as what it says, and a link inside a folder left out", async () => {
  const shared = memoryBucket();
  const desk = await computer("desk", shared);
  const laptop = await computer("laptop", shared);
  const dotfiles = join(directory, "dotfiles");

  await mkdir(join(dotfiles, "skills", "ladder"), { recursive: true });
  await writeFile(join(dotfiles, "AGENTS.md"), "kept with the dotfiles");
  await writeFile(
    join(dotfiles, "skills", "ladder", "SKILL.md"),
    "# 分批進場\n"
  );
  await symlink(
    join(dotfiles, "SKILL.md"),
    join(dotfiles, "skills", "ladder", "elsewhere.md")
  );
  await symlink(
    join(dotfiles, "AGENTS.md"),
    join(desk.folders.configDir, "AGENTS.md")
  );
  await symlink(
    join(dotfiles, "skills"),
    join(desk.folders.configDir, "skills")
  );

  const { key } = await desk.backups.backUp();

  await laptop.backups.restore(key);
  laptop.opened.close();
  takeRestore(laptop.folders);

  // The laptop has no such folder of dotfiles, and needs none.
  await rm(dotfiles, { recursive: true });

  expect(
    await readFile(join(laptop.folders.configDir, "AGENTS.md"), "utf8")
  ).toBe("kept with the dotfiles");
  expect(
    await readdir(join(laptop.folders.configDir, "skills", "ladder"))
  ).toEqual(["SKILL.md"]);
});

test("a folder that changes as it is copied makes no backup, and is named", async () => {
  const shared = memoryBucket();
  const desk = await computer("desk", shared);

  await mkdir(join(desk.folders.workspaces, "conversation-1"), {
    recursive: true,
  });
  await writeFile(
    join(desk.folders.workspaces, "conversation-1", "notes.txt"),
    "kept by a shell command"
  );

  // A command removes a file between the folder being listed and the file being read.
  vi.mocked(cp).mockImplementation(async (from, to, options) => {
    await fs.cp(from, to, options);

    if (String(from).endsWith("agent-workspaces")) {
      throw Object.assign(
        new Error("ENOENT: no such file or directory, copyfile 'scratch.tmp'"),
        { code: "ENOENT" }
      );
    }
  });

  await expect(desk.backups.backUp()).rejects.toThrow(
    `${desk.folders.workspaces} changed while it was being backed up`
  );
  expect(shared.objects.size).toBe(0);
  await expect(desk.backups.status()).resolves.toMatchObject({
    activity: null,
  });
});

test("a restore cut off partway goes on from where it stopped", async () => {
  const shared = memoryBucket();
  const desk = await computer("desk", shared);
  const laptop = await computer("laptop", shared);

  desk.opened.watchlist.add(TSMC);

  const { key } = await desk.backups.backUp();

  laptop.opened.watchlist.add(FOXCONN);
  await laptop.backups.restore(key);
  laptop.opened.close();

  const { previous, staged, cleared } = restorePaths(laptop.folders.dataDir);
  const user = join(laptop.folders.dataDir, "user.sqlite");

  // As if the app had quit once every place was cleared and one database was in.
  await mkdir(join(previous, "databases"), { recursive: true });
  await copyFile(user, join(previous, "databases", "user.sqlite"));
  await rm(user);
  await rm(`${user}-wal`, { force: true });
  await rm(`${user}-shm`, { force: true });
  await writeFile(cleared, "");
  await copyFile(join(staged, "databases", "user.sqlite"), user);
  await rm(join(staged, "databases", "user.sqlite"));

  expect(takeRestore(laptop.folders)).toEqual({ key, createdAt: AT });

  const restored = laptop.user();

  // The database already in was not taken for the one the laptop had.
  expect(restored.watchlist.list()).toEqual([TSMC]);
  restored.close();

  const kept = openUserData(
    join(previous, "databases", "user.sqlite"),
    join(MIGRATIONS, "user")
  );

  expect(kept.watchlist.list()).toEqual([FOXCONN]);
  kept.close();
});

test("a restore that cannot be put in place stops the start and is tried again", async () => {
  const shared = memoryBucket();
  const desk = await computer("desk", shared);
  const laptop = await computer("laptop", shared);
  const { key } = await desk.backups.backUp();

  await laptop.backups.restore(key);
  laptop.opened.close();

  // A file where the settings' folder should be, so nothing can be moved into it.
  const blocked = join(directory, "blocked");

  await writeFile(blocked, "");

  expect(() =>
    takeRestore({ ...laptop.folders, configDir: join(blocked, "config") })
  ).toThrow(RestoreFailure);

  expect(takeRestore(laptop.folders)).toEqual({ key, createdAt: AT });
  expect(laptop.config.read().backup.bucket).toBe("solyx-backups");
});

test("a backup that does not open under this passphrase stages nothing", async () => {
  const shared = memoryBucket();
  const desk = await computer("desk", shared);
  const laptop = await computer("laptop", shared, "another passphrase");
  const { key } = await desk.backups.backUp();

  await expect(laptop.backups.restore(key)).rejects.toThrow(
    "The passphrase does not open this backup"
  );

  expect(laptop.restart).not.toHaveBeenCalled();
  expect(takeRestore(laptop.folders)).toBeNull();
  await expect(laptop.backups.status()).resolves.toMatchObject({
    activity: null,
  });
  expect(await readdir(restorePaths(laptop.folders.dataDir).folder)).toEqual(
    []
  );
});

test("only a backup in the folder is restored, and nothing before backups are set up", async () => {
  const shared = memoryBucket();
  const desk = await computer("desk", shared);

  await expect(
    desk.backups.restore("elsewhere/desk/20261013T080000Z.solyx-backup")
  ).rejects.toThrow("is not a backup in solyx");

  await desk.secrets.delete(Secret.BackupPassphrase);

  await expect(desk.backups.status()).resolves.toMatchObject({ ready: false });
  await expect(desk.backups.backUp()).rejects.toThrow(
    "Set the bucket, its access key and a passphrase before using backups"
  );
  await expect(desk.backups.list()).rejects.toThrow("Set the bucket");
  expect(shared.objects.size).toBe(0);
});

test("one thing goes on at a time, and whoever shows it hears it start and end", async () => {
  const shared = memoryBucket();
  const desk = await computer("desk", shared);
  const first = desk.backups.backUp();

  await expect(desk.backups.backUp()).rejects.toThrow("A backup is being made");
  await expect(desk.backups.status()).resolves.toMatchObject({
    activity: BackupActivity.BackingUp,
  });
  await first;

  expect(desk.onChange).toHaveBeenCalledTimes(2);
  await expect(desk.backups.backUp()).resolves.toMatchObject({ own: true });
});

test("where backups go is saved checked, and read with its defaults", async () => {
  const desk = await computer("desk", memoryBucket());

  await desk.backups.set(
    BackupSetting.Endpoint,
    "https://example.r2.cloudflarestorage.com"
  );
  await desk.backups.set(BackupSetting.Prefix, "backups/solyx");

  await expect(desk.backups.settings()).resolves.toEqual({
    endpoint: "https://example.r2.cloudflarestorage.com",
    region: null,
    bucket: "solyx-backups",
    prefix: "backups/solyx",
    defaults: { region: "us-east-1", prefix: "solyx" },
    automatic: true,
    every: BackupInterval.Hour,
  });

  await expect(
    desk.backups.set(BackupSetting.Prefix, "../elsewhere")
  ).rejects.toThrow();
  await expect(
    desk.backups.set(BackupSetting.Endpoint, "ftp://example.com")
  ).rejects.toThrow();
  await desk.backups.set(BackupSetting.Prefix, null);

  await expect(desk.backups.settings()).resolves.toMatchObject({
    prefix: null,
  });
});

const MINUTE = 60 * 1000;

const HOUR = 60 * MINUTE;

test("a backup is made on its own once one is due, and only when something changed", async () => {
  const shared = memoryBucket();
  const desk = await computer("desk", shared);

  desk.opened.watchlist.add(TSMC);
  await desk.backups.work.run();

  expect(shared.objects.size).toBe(1);

  // Not due again yet, whatever changed meanwhile.
  desk.opened.watchlist.add(FOXCONN);
  desk.clock.now += 59 * MINUTE;
  await desk.backups.work.run();

  expect(shared.objects.size).toBe(1);

  desk.clock.now += MINUTE;
  await desk.backups.work.run();

  expect(shared.objects.size).toBe(2);

  // Due again with nothing changed, so another would only be a second copy of the last.
  desk.clock.now += HOUR;
  await desk.backups.work.run();

  expect(shared.objects.size).toBe(2);
  await expect(desk.backups.status()).resolves.toMatchObject({
    lastBackupAt: AT + HOUR,
    stored: { count: 2 },
  });

  // Having looked counts, so the next look waits a whole span again.
  desk.opened.watchlist.remove(FOXCONN);
  desk.clock.now += 59 * MINUTE;
  await desk.backups.work.run();

  expect(shared.objects.size).toBe(2);

  // A backup the user asks for is made whatever changed.
  desk.opened.watchlist.add(FOXCONN);
  await desk.backups.backUp();
  await desk.backups.backUp().catch(() => undefined);

  expect(shared.objects.size).toBe(3);
});

test("a passphrase changed is backed up under at the next pass, though nothing else changed", async () => {
  const shared = memoryBucket();
  const desk = await computer("desk", shared);

  await desk.backups.work.run();
  desk.clock.now += HOUR;
  await desk.backups.work.run();

  expect(shared.objects.size).toBe(1);

  // None of the backups so far opens under the new one.
  await desk.secrets.save(
    Secret.BackupPassphrase,
    "a passphrase of another day"
  );
  desk.clock.now += MINUTE;
  await desk.backups.work.run();

  expect(shared.objects.size).toBe(2);

  const laptop = await computer(
    "laptop",
    shared,
    "a passphrase of another day"
  );

  await laptop.backups.restore(backupKey("solyx", "desk", AT + HOUR + MINUTE));

  expect(laptop.restart).toHaveBeenCalledOnce();
});

test("a backup that was going up as the passphrase changed is not taken for one under the new", async () => {
  const shared = memoryBucket();
  const desk = await computer("desk", shared);
  const put = shared.bucket.put.bind(shared.bucket);

  vi.spyOn(shared.bucket, "put").mockImplementationOnce(async (key, file) => {
    await put(key, file);
    await desk.secrets.save(Secret.BackupPassphrase, "changed meanwhile");
  });

  await desk.backups.work.run();
  desk.clock.now += HOUR;
  await desk.backups.work.run();

  expect(shared.objects.size).toBe(2);
});

test("a pass that found nothing changed as the passphrase changed leaves the next to back up", async () => {
  const shared = memoryBucket();
  const jobs = createBackupJobs(() => shared.bucket);

  const desk = await computer("desk", shared, "correct horse", {
    ...jobs,
    async backUpIfChanged(options) {
      const made = await jobs.backUpIfChanged(options);

      if (!made) {
        await desk.secrets.save(Secret.BackupPassphrase, "changed meanwhile");
      }

      return made;
    },
  });

  await desk.backups.work.run();
  desk.clock.now += HOUR;
  await desk.backups.work.run();

  expect(shared.objects.size).toBe(1);

  desk.clock.now += MINUTE;
  await desk.backups.work.run();

  expect(shared.objects.size).toBe(2);
});

test("another bucket or folder is backed up to as if for the first time", async () => {
  const shared = memoryBucket();
  const desk = await computer("desk", shared);

  await desk.backups.work.run();
  await desk.backups.set(BackupSetting.Prefix, "moved");

  // What was counted is the other folder's.
  await expect(desk.backups.status()).resolves.toMatchObject({
    lastBackupAt: null,
    stored: null,
  });

  desk.clock.now += MINUTE;
  await desk.backups.work.run();

  expect([...shared.objects.keys()]).toEqual([
    "solyx/desk/20261013T080000Z.solyx-backup",
    "moved/desk/20261013T080100Z.solyx-backup",
  ]);
  await expect(desk.backups.status()).resolves.toMatchObject({
    lastBackupAt: AT + MINUTE,
    stored: { count: 1 },
  });
});

test("nothing is made on its own while that is off, set to a longer span, or not set up", async () => {
  const shared = memoryBucket();
  const desk = await computer("desk", shared);

  await desk.backups.setAutomatic(false);
  await desk.backups.work.run();

  expect(shared.objects.size).toBe(0);

  await desk.backups.setAutomatic(true);
  await desk.backups.setEvery(BackupInterval.Day);
  await desk.backups.work.run();
  desk.opened.watchlist.add(TSMC);
  desk.clock.now += 23 * HOUR;
  await desk.backups.work.run();

  expect(shared.objects.size).toBe(1);

  desk.clock.now += HOUR;
  await desk.secrets.delete(Secret.BackupPassphrase);
  await desk.backups.work.run();

  expect(shared.objects.size).toBe(1);
  expect(desk.diagnostics.recovered).not.toHaveBeenCalled();
});

test("after a backup the installation's older ones thin out, and nothing else in the bucket goes", async () => {
  const shared = memoryBucket();
  const desk = await computer("desk", shared);
  const DAY = 24 * HOUR;

  // A backup a day over two months, the laptop's among them, and a file someone else put there.
  for (let day = 1; day <= 60; day += 1) {
    for (const installation of ["desk", "laptop"]) {
      shared.objects.set(
        backupKey("solyx", installation, AT - day * DAY),
        Buffer.alloc(10)
      );
    }
  }

  shared.objects.set("solyx/desk/notes.txt", Buffer.from("not a backup"));

  const made = await desk.backups.backUp();
  const kept = [...shared.objects.keys()];

  const own = kept.filter(
    (key) => readBackupKey("solyx", key)?.installation === "desk"
  );

  // The last of each of 24 hours that hold one, which a backup a day makes 24 days, the newest
  // four, seven days and four weeks all among them.
  expect(own).toHaveLength(24);
  expect(own).toContain(made.key);
  expect(kept.filter((key) => key.startsWith("solyx/laptop/"))).toHaveLength(
    60
  );
  expect(kept).toContain("solyx/desk/notes.txt");
  await expect(desk.backups.status()).resolves.toMatchObject({
    stored: { count: 24, bytes: made.bytes + 230 },
    failure: null,
  });
});

test("a bucket out of reach is said why and tried again later, never every minute", async () => {
  const shared = memoryBucket();
  const desk = await computer("desk", shared);
  const offline = new Error("r2.example: fetch failed");
  const put = vi.spyOn(shared.bucket, "put").mockRejectedValue(offline);

  await desk.backups.work.run();

  expect(desk.diagnostics.recovered).toHaveBeenCalledWith(
    offline,
    "backup.pass"
  );
  await expect(desk.backups.status()).resolves.toMatchObject({
    activity: null,
    lastBackupAt: null,
    failure: "r2.example: fetch failed",
  });

  desk.clock.now += 14 * MINUTE;
  await desk.backups.work.run();

  expect(put).toHaveBeenCalledOnce();

  put.mockRestore();
  desk.clock.now += MINUTE;
  await desk.backups.work.run();

  expect(shared.objects.size).toBe(1);
  await expect(desk.backups.status()).resolves.toMatchObject({
    failure: null,
  });
});

test("a backup that fails after going on a long while waits from when it failed", async () => {
  const shared = memoryBucket();
  const desk = await computer("desk", shared);

  // An upload twenty minutes in when the connection drops.
  const put = vi.spyOn(shared.bucket, "put").mockImplementation(async () => {
    desk.clock.now += 20 * MINUTE;

    throw new Error("r2.example: fetch failed");
  });

  await desk.backups.work.run();
  desk.clock.now += MINUTE;
  await desk.backups.work.run();

  expect(put).toHaveBeenCalledOnce();

  desk.clock.now += 14 * MINUTE;
  await desk.backups.work.run();

  expect(put).toHaveBeenCalledTimes(2);
});

test("a backup stays made when thinning out the older ones fails", async () => {
  const shared = memoryBucket();
  const desk = await computer("desk", shared);

  // As ky throws it, with the server's answer beside the message.
  const refused = Object.assign(
    new Error("r2.example answered 403 AccessDenied"),
    { name: "HTTPError", response: { status: 403 } }
  );

  for (let day = 1; day <= 60; day += 1) {
    shared.objects.set(
      backupKey("solyx", "desk", AT - day * 24 * HOUR),
      Buffer.alloc(10)
    );
  }

  vi.spyOn(shared.bucket, "remove").mockRejectedValue(refused);

  const made = await desk.backups.backUp();

  expect(shared.objects.has(made.key)).toBe(true);
  expect(shared.objects.size).toBe(61);
  // What kind of failure it was reaches the log, though the error itself stayed with the job.
  expect(desk.diagnostics.recovered).toHaveBeenCalledWith(
    expect.objectContaining({
      message: "r2.example answered 403 AccessDenied",
      name: "HTTPError",
      status: 403,
    }),
    "backup.thin"
  );
  await expect(desk.backups.status()).resolves.toMatchObject({
    lastBackupAt: AT,
    stored: null,
    failure: "r2.example answered 403 AccessDenied",
  });
});

test("a key names its installation and moment, and anything else in the folder is no backup", () => {
  const key = backupKey("backups/solyx", "desk", AT);

  expect(key).toBe("backups/solyx/desk/20261013T080000Z.solyx-backup");
  expect(readBackupKey("backups/solyx", key)).toEqual({
    installation: "desk",
    createdAt: AT,
  });

  for (const other of [
    "backups/solyx/desk/notes.txt",
    "backups/solyx/20261013T080000Z.solyx-backup",
    "backups/solyx/desk/deeper/20261013T080000Z.solyx-backup",
    "backups/solyx/desk/2026-10-13.solyx-backup",
    "backups/solyx-nightly/desk/20261013T080000Z.solyx-backup",
  ]) {
    expect(readBackupKey("backups/solyx", other)).toBeUndefined();
  }
});
