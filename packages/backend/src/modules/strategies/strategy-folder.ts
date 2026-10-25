import { createHash } from "node:crypto";
import { lstat, readFile, readdir, readlink, stat } from "node:fs/promises";
import { join } from "node:path";

import { parse } from "yaml";
import * as z from "zod";

import type { StrategyFile } from "@solyx/api/strategies";
import { strategyManifestSchema } from "@solyx/core/strategy";
import type { StrategyManifest } from "@solyx/core/strategy";
import { errorMessage, isErrnoError } from "@solyx/utils/error";

/** A strategy as its folder holds it now. */
export interface Strategy {
  manifest: StrategyManifest;
  /** What its STRATEGY.md says below the frontmatter. */
  notes: string;
  folder: string;
  /** Its files' paths and contents taken together, so a change to any of them is another version. */
  version: string;
  files: StrategyFile[];
}

/** The most files a strategy's folder holds, so its version can be told on every run. */
const MAX_STRATEGY_FILES = 1000;

/** The most its files hold between them. */
const MAX_STRATEGY_BYTES = 32 * 1024 * 1024;

// What a tool keeps beside the code, which no run reads as code.
const LEFT_OUT = new Set([".git", "__pycache__", ".DS_Store"]);

const FRONTMATTER = /^---\n([\s\S]*?)\n---(?:\n|$)/;

const digest = (data: string | Buffer) =>
  createHash("sha256").update(data).digest("hex");

/**
 * Every file under `folder`, each by its path from it and a digest of what it holds, oldest path
 * first. A link counts by where it points, not by what it reaches, since the sandbox reads only
 * the folder.
 */
async function folderFiles(folder: string) {
  const files: (StrategyFile & { digest: string })[] = [];
  let bytes = 0;

  async function walk(path: string, relative: string) {
    for (const name of (await readdir(path)).toSorted()) {
      if (LEFT_OUT.has(name)) continue;

      const full = join(path, name);
      const inside = relative ? `${relative}/${name}` : name;
      const entry = await lstat(full);

      if (entry.isDirectory()) {
        await walk(full, inside);

        continue;
      }

      if (files.length >= MAX_STRATEGY_FILES) {
        throw new Error(
          `holds more than ${MAX_STRATEGY_FILES} files; keep environments and packages outside it, on the PATH`
        );
      }

      bytes += entry.size;

      if (bytes > MAX_STRATEGY_BYTES) {
        throw new Error(
          `holds more than ${MAX_STRATEGY_BYTES / 1024 / 1024} MB; keep data and packages outside it`
        );
      }

      const content = entry.isSymbolicLink()
        ? `link:${await readlink(full)}`
        : await readFile(full);

      files.push({ path: inside, bytes: entry.size, digest: digest(content) });
    }
  }

  await walk(folder, "");

  return files;
}

/** One version for the files of a strategy, each by its path and what it holds. */
const versionOf = (files: readonly { path: string; digest: string }[]) =>
  digest(files.map((file) => `${file.path}\0${file.digest}\n`).join(""));

/** The strategy `STRATEGY.md` names in `folder`, which must take the folder's name. */
async function readStrategy(folder: string, name: string): Promise<Strategy> {
  const text = (await readFile(join(folder, "STRATEGY.md"), "utf8")).replace(
    /\r\n?/g,
    "\n"
  );

  const match = FRONTMATTER.exec(text);

  if (!match) {
    throw new Error("STRATEGY.md opens with no frontmatter between --- lines");
  }

  const parsed = strategyManifestSchema.safeParse(parse(match[1]) ?? {});

  if (!parsed.success) throw new Error(z.prettifyError(parsed.error));

  // A strategy is allowed and asked for by its name, so one its folder does not give could stand
  // in for another.
  if (parsed.data.name !== name) {
    throw new Error(
      `name "${parsed.data.name}" does not match its folder "${name}"`
    );
  }

  const files = await folderFiles(folder);

  return {
    manifest: parsed.data,
    notes: text.slice(match[0].length).trim(),
    folder,
    version: versionOf(files),
    files: files.map(({ path, bytes }) => ({ path, bytes })),
  };
}

/**
 * Every `<name>/STRATEGY.md` under `root`, as the files are now. A folder without one holds no
 * strategy; one whose STRATEGY.md does not read, or whose files are too many to tell its version
 * by, is named among the problems instead.
 */
export async function readStrategies(root: string) {
  const strategies: Strategy[] = [];
  const problems: string[] = [];

  let names: string[];

  try {
    names = await readdir(root);
  } catch (error) {
    // A folder the user never made holds no strategies.
    if (!isErrnoError(error, "ENOENT")) {
      problems.push(`${root}: ${errorMessage(error)}`);
    }

    return { strategies, problems };
  }

  for (const name of names.toSorted()) {
    if (name.startsWith(".")) continue;

    const folder = join(root, name);

    try {
      // Followed through a link, since a strategy kept elsewhere is often linked into place.
      if (!(await stat(folder)).isDirectory()) continue;

      strategies.push(await readStrategy(folder, name));
    } catch (error) {
      // A folder without STRATEGY.md holds no strategy.
      if (!isErrnoError(error, "ENOENT")) {
        problems.push(`${join(folder, "STRATEGY.md")}: ${errorMessage(error)}`);
      }
    }
  }

  return { strategies, problems };
}
