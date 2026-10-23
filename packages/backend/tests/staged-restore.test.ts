import { cpSync, renameSync, rmSync } from "node:fs";
import type * as NodeFs from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";

import type { DataFolders } from "../src/modules/backup/backup-places.ts";
import {
  RestoreFailure,
  restorePaths,
  stageRestore,
  takeRestore,
} from "../src/modules/backup/staged-restore.ts";

vi.mock("node:fs", async (importOriginal) => {
  const fs = await importOriginal<typeof NodeFs>();

  return {
    ...fs,
    cpSync: vi.fn(fs.cpSync),
    renameSync: vi.fn(fs.renameSync),
    rmSync: vi.fn(fs.rmSync),
  };
});

const fs = await vi.importActual<typeof NodeFs>("node:fs");

const STAGED = {
  key: "solyx/desk/20261013T080000Z.solyx-backup",
  createdAt: 0,
};

let directory: string;

let folders: DataFolders;

async function write(file: string, text: string) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, text);
}

/** Every file under `folder` by its path in it, or nothing where there is no such folder. */
async function filesIn(folder: string) {
  const entries = await readdir(folder, {
    recursive: true,
    withFileTypes: true,
  }).catch(() => []);

  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name).slice(folder.length + 1))
    .toSorted();
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "solyx-staged-restore-"));

  folders = {
    dataDir: join(directory, "data"),
    // As when the settings' folder is a link to one kept on another disk.
    configDir: join(directory, "other-volume", "config"),
    workspaces: join(directory, "data", "agent-workspaces"),
  };

  const { staged } = restorePaths(folders.dataDir);

  await write(join(folders.dataDir, "user.sqlite"), "the laptop's rows");
  await write(join(folders.configDir, "config.json"), "the laptop's");
  await write(join(folders.configDir, "skills", "old", "SKILL.md"), "old");
  await write(join(folders.configDir, "skills", "older", "SKILL.md"), "older");

  await write(join(staged, "databases", "user.sqlite"), "the backup's rows");
  await write(join(staged, "config", "config.json"), "the backup's");
  await write(join(staged, "config", "skills", "new", "SKILL.md"), "new");
  await write(join(staged, "config", "skills", "newer", "SKILL.md"), "newer");
  stageRestore(folders.dataDir, STAGED);

  // A rename cannot go from one volume to another.
  vi.mocked(renameSync).mockImplementation((from, to) => {
    const crosses =
      String(from).startsWith(folders.configDir) !==
      String(to).startsWith(folders.configDir);

    if (crosses) {
      throw Object.assign(new Error("EXDEV: cross-device link not permitted"), {
        code: "EXDEV",
      });
    }

    fs.renameSync(from, to);
  });
});

afterEach(async () => {
  vi.mocked(cpSync).mockImplementation(fs.cpSync);
  vi.mocked(rmSync).mockImplementation(fs.rmSync);
  await rm(directory, { recursive: true, force: true });
});

/** Both sides hold all of their own and none of the other's. */
async function expectSwapped() {
  const { previous, staged } = restorePaths(folders.dataDir);

  expect(await filesIn(folders.configDir)).toEqual([
    "config.json",
    "skills/new/SKILL.md",
    "skills/newer/SKILL.md",
  ]);
  expect(await readFile(join(folders.configDir, "config.json"), "utf8")).toBe(
    "the backup's"
  );
  expect(await readFile(join(folders.dataDir, "user.sqlite"), "utf8")).toBe(
    "the backup's rows"
  );
  expect(await filesIn(previous)).toEqual([
    "config/config.json",
    "config/skills/old/SKILL.md",
    "config/skills/older/SKILL.md",
    "databases/user.sqlite",
  ]);
  expect(await readFile(join(previous, "config", "config.json"), "utf8")).toBe(
    "the laptop's"
  );
  expect(await filesIn(staged)).toEqual([]);
}

test("what is kept on another volume is copied across whole, both ways", async () => {
  expect(takeRestore(folders)).toEqual(STAGED);

  await expectSwapped();
});

test("a copy to another volume cut off partway is made again, not taken for the move", async () => {
  // The app quits with one of the two skills copied out.
  vi.mocked(cpSync).mockImplementation((from, to, options) => {
    if (from !== join(folders.configDir, "skills")) {
      return fs.cpSync(from, to, options);
    }

    vi.mocked(cpSync).mockImplementation(fs.cpSync);
    fs.cpSync(join(from, "old"), join(String(to), "old"), { recursive: true });

    throw new Error("cut off");
  });

  expect(() => takeRestore(folders)).toThrow(RestoreFailure);
  expect(takeRestore(folders)).toEqual(STAGED);

  await expectSwapped();
});

test("a move cut off once its copy was whole only has the rest of what it was made from removed", async () => {
  const { staged } = restorePaths(folders.dataDir);

  // The app quits twice with a folder copied across and half of where it came from removed.
  for (const [from, half] of [
    [join(folders.configDir, "skills"), "old"],
    [join(staged, "config", "skills"), "new"],
  ] as const) {
    vi.mocked(rmSync).mockImplementation((path, options) => {
      if (path !== from) return fs.rmSync(path, options);

      fs.rmSync(join(from, half), options);

      throw new Error("cut off");
    });

    expect(() => takeRestore(folders)).toThrow(RestoreFailure);
  }

  vi.mocked(rmSync).mockImplementation(fs.rmSync);

  expect(takeRestore(folders)).toEqual(STAGED);

  await expectSwapped();
});
