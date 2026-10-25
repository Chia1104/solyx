import { createHash } from "node:crypto";
import { lstat, readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";

import { parse } from "yaml";
import * as z from "zod";

import type { StrategyFile } from "@solyx/api/strategies";
import { strategyManifestSchema } from "@solyx/core/strategy";
import type { StrategyManifest } from "@solyx/core/strategy";
import { errorMessage, isErrnoError } from "@solyx/utils/error";

/** One file of a strategy's folder, as it was read. */
interface CodeFile {
  /** From the strategy's folder, with `/` between folders. */
  path: string;
  data: Buffer;
}

/**
 * A strategy as its folder held it when it was read. A run copies `code` and runs the copy, so the
 * files its version was told from are the files that run, whatever the folder holds by then.
 */
export interface Strategy {
  manifest: StrategyManifest;
  /** What its STRATEGY.md says below the frontmatter. */
  notes: string;
  folder: string;
  /** Its files' paths and contents taken together, so a change to any of them is another version. */
  version: string;
  code: readonly CodeFile[];
}

// Text the decisions model and a window read; a file with a NUL or bytes that are no UTF-8 is not.
const textDecoder = new TextDecoder("utf-8", { fatal: true });

/** What `data` says as text, `null` where it is not text. */
function textOf(data: Buffer) {
  if (data.includes(0)) return null;

  try {
    return textDecoder.decode(data);
  } catch {
    return null;
  }
}

/** A strategy's files with what each says, as a window and the agent read them. */
export const strategyTexts = (strategy: Strategy) =>
  strategy.code.map(({ path, data }) => ({
    path,
    bytes: data.length,
    text: textOf(data),
  }));

/** What a window is told of a strategy's files. */
export const strategyFiles = (strategy: Strategy): StrategyFile[] =>
  strategy.code.map(({ path, data }) => ({ path, bytes: data.length }));

/** The most files a strategy's folder holds, so its version can be told on every run. */
const MAX_STRATEGY_FILES = 1000;

/** The most its files hold between them. */
const MAX_STRATEGY_BYTES = 32 * 1024 * 1024;

// What a tool keeps beside the code, which a run neither copies nor reads.
const LEFT_OUT = new Set([".git", "__pycache__", ".DS_Store"]);

const FRONTMATTER = /^---\n([\s\S]*?)\n---(?:\n|$)/;

const digest = (data: string | Buffer) =>
  createHash("sha256").update(data).digest("hex");

/**
 * Every file under `folder`, each by its path from it and what it holds, oldest path first. A link
 * is refused, since what it points to could change while the version stays.
 */
async function folderFiles(folder: string) {
  const files: CodeFile[] = [];
  let bytes = 0;

  async function walk(path: string, relative: string) {
    for (const name of (await readdir(path)).toSorted()) {
      if (LEFT_OUT.has(name)) continue;

      const full = join(path, name);
      const inside = relative ? `${relative}/${name}` : name;
      const entry = await lstat(full);

      if (entry.isSymbolicLink()) {
        throw new Error(
          `holds a link at ${inside}; copy what it points to into the folder instead`
        );
      }

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

      files.push({ path: inside, data: await readFile(full) });
    }
  }

  await walk(folder, "");

  return files;
}

/** One version for the files of a strategy, each by its path and what it holds. */
const versionOf = (files: readonly CodeFile[]) =>
  digest(files.map((file) => `${file.path}\0${digest(file.data)}\n`).join(""));

/** The strategy `STRATEGY.md` names in `folder`, which must take the folder's name. */
async function readStrategy(folder: string, name: string): Promise<Strategy> {
  // A folder without STRATEGY.md holds no strategy, and fails here as not found.
  await stat(join(folder, "STRATEGY.md"));

  // The manifest is read from the same bytes the version is told from, so the command that runs is
  // the one allowed.
  const code = await folderFiles(folder);
  const own = code.find((file) => file.path === "STRATEGY.md");

  if (own === undefined) throw new Error("STRATEGY.md is gone");

  const text = own.data.toString("utf8").replace(/\r\n?/g, "\n");
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

  return {
    manifest: parsed.data,
    notes: text.slice(match[0].length).trim(),
    folder,
    version: versionOf(code),
    code,
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
