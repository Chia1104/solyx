import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, expect, test } from "vite-plus/test";

import { readBundle, writeBundle } from "../src/bundle.ts";

const origin = {
  app: "Solyx",
  version: "1.2.3",
  installation: "6f1c2f0e-6c1b-4f1f-9d39-3d1a5f0c7b11",
  createdAt: Date.UTC(2026, 9, 13, 8),
};

let directory: string;

let folder: string;

let file: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "solyx-bundle-"));
  folder = join(directory, "source");
  file = join(directory, "backup.solyx-backup");

  await mkdir(join(folder, "config", "skills", "ladder"), { recursive: true });
  await writeFile(join(folder, "config", "config.json"), '{"tray":{}}\n');
  await writeFile(
    join(folder, "config", "skills", "ladder", "SKILL.md"),
    "# 分批進場\n"
  );
  // Larger than one read of the file, so the content crosses chunks.
  await writeFile(
    join(folder, "user.sqlite"),
    Buffer.alloc(300_000, "synthetic rows ")
  );
});

afterEach(() => rm(directory, { recursive: true, force: true }));

test("a folder comes back whole under its passphrase, with who made it", async () => {
  const restored = join(directory, "restored");

  await writeBundle({
    folder,
    file,
    passphrase: "三隻小豬 build a house",
    origin,
  });

  await expect(
    readBundle({ file, folder: restored, passphrase: "三隻小豬 build a house" })
  ).resolves.toEqual(origin);

  expect(await readdir(restored)).toEqual(["config", "user.sqlite"]);
  expect(
    await readFile(
      join(restored, "config", "skills", "ladder", "SKILL.md"),
      "utf8"
    )
  ).toBe("# 分批進場\n");
  expect(await readFile(join(restored, "user.sqlite"))).toEqual(
    await readFile(join(folder, "user.sqlite"))
  );
});

test("nothing of the folder can be read in the file, which only its owner may open", async () => {
  await writeBundle({ folder, file, passphrase: "correct horse", origin });

  const sealed = await readFile(file);

  expect(sealed.includes("synthetic rows")).toBe(false);
  expect(sealed.includes("config.json")).toBe(false);
  expect((await stat(file)).mode & 0o777).toBe(0o600);
});

test("a wrong passphrase unpacks nothing", async () => {
  const restored = join(directory, "restored");

  await writeBundle({ folder, file, passphrase: "correct horse", origin });

  await expect(
    readBundle({ file, folder: restored, passphrase: "correct house" })
  ).rejects.toThrow("The passphrase does not open this backup");
  await expect(stat(restored)).rejects.toThrow("ENOENT");
});

test("a file changed after it was sealed unpacks nothing, its header included", async () => {
  const restored = join(directory, "restored");

  await writeBundle({ folder, file, passphrase: "correct horse", origin });

  const sealed = await readFile(file);
  const flipped = Buffer.from(sealed);
  const middle = Math.floor(sealed.length / 2);

  flipped[middle] = (flipped[middle] ?? 0) ^ 1;
  await writeFile(file, flipped);

  await expect(
    readBundle({ file, folder: restored, passphrase: "correct horse" })
  ).rejects.toThrow("the file was changed");

  // The header is not secret, but what it says of the backup is covered by the tag too.
  await writeFile(
    file,
    Buffer.from(sealed.toString("latin1").replace("1.2.3", "9.9.9"), "latin1")
  );

  await expect(
    readBundle({ file, folder: restored, passphrase: "correct horse" })
  ).rejects.toThrow("the file was changed");
  await expect(stat(restored)).rejects.toThrow("ENOENT");
});

test("a file that is not a bundle is refused before any passphrase is tried", async () => {
  await writeFile(file, "<html><body>Sign in to continue</body></html>\n");

  await expect(
    readBundle({ file, folder: join(directory, "restored"), passphrase: "x" })
  ).rejects.toThrow("This file is not a Solyx backup");
});
