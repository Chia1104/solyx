import { createHash, randomBytes } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  renameSync,
  watch,
  writeFileSync,
} from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, dirname } from "node:path";

import { debounce } from "es-toolkit";
import type * as z from "zod";

import { isErrnoError } from "./error.ts";
import { parseJson } from "./json.ts";

/**
 * Calls `onChange` shortly after `file` changes on disk, whoever changed it, until the returned
 * function stops watching. The file's folder must exist.
 */
export function watchFile(file: string, onChange: () => void): () => void {
  const notify = debounce(onChange, 200);

  // Editors often save by renaming a new file into place, so the folder is watched.
  const watcher = watch(dirname(file), (_event, name) => {
    if (name === basename(file)) notify();
  });

  return () => {
    notify.cancel();
    watcher.close();
  };
}

/** A file's text, or `undefined` where there is no such file. */
export async function readTextIfExists(file: string) {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if (isErrnoError(error, "ENOENT")) return undefined;

    throw error;
  }
}

export function readTextIfExistsSync(file: string) {
  try {
    return readFileSync(file, "utf8");
  } catch (error) {
    if (isErrnoError(error, "ENOENT")) return undefined;

    throw error;
  }
}

/** A JSON file as `schema` reads it; `undefined` where there is no such file or it does not parse. */
export async function readJson<Schema extends z.ZodType>(
  file: string,
  schema: Schema
) {
  const text = await readTextIfExists(file);

  return text === undefined ? undefined : parseJson(text, schema);
}

export function readJsonSync<Schema extends z.ZodType>(
  file: string,
  schema: Schema
) {
  const text = readTextIfExistsSync(file);

  return text === undefined ? undefined : parseJson(text, schema);
}

export interface WriteOptions {
  /** The new file's permissions, such as `0o600` for one only its owner reads. */
  mode?: number;
}

/**
 * Writes `text` beside `file` and renames it into place, so a crash mid-write keeps the previous
 * file; the folder is made first.
 */
export async function writeFileAtomic(
  file: string,
  text: string,
  { mode }: WriteOptions = {}
) {
  const temporary = `${file}.tmp`;

  await mkdir(dirname(file), { recursive: true });
  await writeFile(temporary, text, { mode });
  await rename(temporary, file);
}

export function writeFileAtomicSync(
  file: string,
  text: string,
  { mode }: WriteOptions = {}
) {
  const temporary = `${file}.tmp`;

  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(temporary, text, { mode });
  renameSync(temporary, file);
}

/** 32 random bytes in base64url, for a sign-in's state, nonce or PKCE verifier. */
export const randomToken = () => randomBytes(32).toString("base64url");

/** The `S256` challenge PKCE sends for `verifier`. */
export const pkceChallenge = (verifier: string) =>
  createHash("sha256").update(verifier).digest("base64url");
