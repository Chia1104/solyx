import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";

import { parse } from "yaml";
import * as z from "zod";

import type { StrategyFile } from "@solyx/api/strategies";
import {
  STRATEGY_LEFT_OUT,
  strategyManifestSchema,
} from "@solyx/core/strategy";
import type { StrategyChange, StrategyManifest } from "@solyx/core/strategy";
import { errorMessage, isErrnoError } from "@solyx/utils/error";
import { writeFileAtomic } from "@solyx/utils/server";

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
    digest: digest(data),
    text: textOf(data),
  }));

/** What a window is told of a strategy's files. */
export const strategyFiles = (strategy: Strategy): StrategyFile[] =>
  strategy.code.map(({ path, data }) => ({
    path,
    bytes: data.length,
    digest: digest(data),
  }));

/** The most files a strategy's folder holds, so its version can be told on every run. */
const MAX_STRATEGY_FILES = 1000;

/** The most its files hold between them. */
const MAX_STRATEGY_BYTES = 32 * 1024 * 1024;

const LEFT_OUT = new Set(STRATEGY_LEFT_OUT);

const FRONTMATTER = /^---\n([\s\S]*?)\n---(?:\n|$)/;

/** Refuses a folder of `count` files holding `bytes` between them past the limits. */
function checkSize(count: number, bytes: number) {
  if (count > MAX_STRATEGY_FILES) {
    throw new Error(
      `holds more than ${MAX_STRATEGY_FILES} files; keep environments and packages outside it, on the PATH`
    );
  }

  if (bytes > MAX_STRATEGY_BYTES) {
    throw new Error(
      `holds more than ${MAX_STRATEGY_BYTES / 1024 / 1024} MB; keep data and packages outside it`
    );
  }
}

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

      bytes += entry.size;
      checkSize(files.length + 1, bytes);

      files.push({ path: inside, data: await readFile(full) });
    }
  }

  await walk(folder, "");

  return files;
}

/** One version for the files of a strategy, each by its path and what it holds. */
const versionOf = (files: readonly CodeFile[]) =>
  digest(files.map((file) => `${file.path}\0${digest(file.data)}\n`).join(""));

/** The strategy `code`, as `folder` holds it, makes, its `STRATEGY.md` naming it after the folder. */
function strategyOf(
  folder: string,
  name: string,
  code: readonly CodeFile[]
): Strategy {
  // The manifest is read from the same bytes the version is told from, so the command that runs is
  // the one allowed.
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

/** The strategy `STRATEGY.md` names in `folder`, which must take the folder's name. */
async function readStrategy(folder: string, name: string): Promise<Strategy> {
  // A folder without STRATEGY.md holds no strategy, and fails here as not found.
  await stat(join(folder, "STRATEGY.md"));

  return strategyOf(folder, name, await folderFiles(folder));
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

/** Compares two paths in the order a folder's walk reads them, each folder's names sorted, which a version is told in. */
function walkOrder(left: string, right: string) {
  const a = left.split("/");
  const b = right.split("/");

  for (let index = 0; index < Math.min(a.length, b.length); index++) {
    if (a[index] !== b[index]) return a[index] < b[index] ? -1 : 1;
  }

  return a.length - b.length;
}

/**
 * Refuses paths that would land on one another: two that differ only in case, which macOS and
 * Windows keep as one file, and a file where another's folder is.
 */
function checkPlaces(paths: readonly string[]) {
  const byCase = new Map<string, string>();
  const folders = new Set<string>();

  for (const path of paths) {
    const folded = path.toLowerCase();
    const other = byCase.get(folded);

    if (other !== undefined) {
      throw new Error(
        `${other} and ${path} would be one file on macOS and Windows`
      );
    }

    byCase.set(folded, path);

    const parts = folded.split("/");

    for (let end = 1; end < parts.length; end++) {
      folders.add(parts.slice(0, end).join("/"));
    }
  }

  for (const [folded, path] of byCase) {
    if (folders.has(folded)) {
      throw new Error(`${path} would be a file and a folder at once`);
    }
  }
}

/** The strategy `folder` holds, `null` where there is no such folder. */
async function currentStrategy(folder: string, name: string) {
  try {
    if (!(await stat(folder)).isDirectory()) {
      throw new Error(`${name} in the strategies folder is a file`);
    }
  } catch (error) {
    if (isErrnoError(error, "ENOENT")) return null;

    throw error;
  }

  try {
    return await readStrategy(folder, name);
  } catch (error) {
    if (isErrnoError(error, "ENOENT")) {
      throw new Error(
        `The folder ${name} holds no STRATEGY.md, so it is no strategy to change: pick another name`,
        { cause: error }
      );
    }

    throw new Error(
      `${name}'s folder does not read as a strategy, which only the user can fix: ${errorMessage(error)}`,
      { cause: error }
    );
  }
}

/**
 * What `name`'s folder under `root` holds now, `null` where there is none, and the strategy it would
 * hold once `change` is made. Refused where that would not read as a strategy, or would pass the
 * folder's limits. Removing a file it does not hold changes nothing.
 */
export async function draftStrategy(
  root: string,
  name: string,
  change: StrategyChange
) {
  const named = [...change.files.map((file) => file.path), ...change.remove];
  const twice = named.find((path, index) => named.indexOf(path) !== index);

  if (twice !== undefined) {
    throw new Error(`${twice} is named twice; write or remove each file once`);
  }

  const folder = join(root, name);
  const current = await currentStrategy(folder, name);

  const files = new Map(
    (current?.code ?? []).map((file) => [file.path, file.data])
  );

  for (const path of change.remove) {
    if ([...files.keys()].some((each) => each.startsWith(`${path}/`))) {
      throw new Error(
        `${path} is a folder; name each of its files to remove it`
      );
    }

    files.delete(path);
  }

  for (const { path, text } of change.files) {
    files.set(path, Buffer.from(text, "utf8"));
  }

  const code = [...files]
    .map(([path, data]) => ({ path, data }))
    .toSorted((left, right) => walkOrder(left.path, right.path));

  checkPlaces(code.map((file) => file.path));

  try {
    checkSize(
      code.length,
      code.reduce((bytes, file) => bytes + file.data.length, 0)
    );
  } catch (error) {
    throw new Error(`${name} then ${errorMessage(error)}`, { cause: error });
  }

  try {
    return { current, draft: strategyOf(folder, name, code) };
  } catch (error) {
    throw new Error(`${name}/STRATEGY.md: ${errorMessage(error)}`, {
      cause: error,
    });
  }
}

/** Makes `change` in `name`'s folder under `root`, each file written whole, and reads what it then holds. */
export async function writeStrategyChange(
  root: string,
  name: string,
  change: StrategyChange
) {
  const folder = join(root, name);
  const place = (path: string) => join(folder, ...path.split("/"));

  await mkdir(folder, { recursive: true });

  for (const path of change.remove) await rm(place(path), { force: true });

  for (const { path, text } of change.files) {
    await writeFileAtomic(place(path), text);
  }

  return readStrategy(folder, name);
}
