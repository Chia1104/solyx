import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { Mutex, omit, zipObject } from "es-toolkit";
import * as z from "zod";

import { isErrnoError } from "@solyx/utils/error";

import { Secret, SecretState } from "#shared/ipc/settings.ts";
import type { SecretKey } from "#shared/ipc/settings.ts";

interface Decrypted {
  plainText: string;
  /** The OS rotated its key; storing the value again moves it to the new key. */
  shouldReEncrypt: boolean;
}

/** Encrypts with a key the OS keeps, so the ciphertext on disk is useless anywhere else. */
export interface SecretCipher {
  /** False where the OS offers no secret store to protect that key. */
  isAvailable(): Promise<boolean>;
  encrypt(plainText: string): Promise<Buffer>;
  decrypt(encrypted: Buffer): Promise<Decrypted>;
}

// Base64 ciphertext per secret id; ids the app no longer knows are ignored.
const secretFileSchema = z.record(z.string(), z.base64());

type SecretFile = z.infer<typeof secretFileSchema>;

function parseSecretFile(text: string): SecretFile {
  try {
    return secretFileSchema.parse(JSON.parse(text));
  } catch {
    // Nothing in a file that no longer parses can be decrypted, so the next save replaces it.
    return {};
  }
}

/** Saved secrets as one file of ciphertext; values are decrypted only in the main process, on demand. */
export function createSecretStore(file: string, cipher: SecretCipher) {
  // A save reads, changes and rewrites the file, so saves run one at a time.
  const mutex = new Mutex();

  async function read(): Promise<SecretFile> {
    try {
      return parseSecretFile(await readFile(file, "utf8"));
    } catch (error) {
      if (isErrnoError(error, "ENOENT")) return {};

      throw error;
    }
  }

  async function update(change: (entries: SecretFile) => SecretFile) {
    await mutex.acquire();

    try {
      const temporary = `${file}.tmp`;

      await mkdir(dirname(file), { recursive: true });
      // Written aside and renamed into place, so a crash mid-write keeps the previous file.
      await writeFile(temporary, JSON.stringify(change(await read())), {
        mode: 0o600,
      });
      await rename(temporary, file);
    } finally {
      mutex.release();
    }
  }

  async function decrypt(entry: string): Promise<Decrypted | undefined> {
    try {
      return await cipher.decrypt(Buffer.from(entry, "base64"));
    } catch {
      return undefined;
    }
  }

  async function stateOf(entry: string | undefined): Promise<SecretState> {
    if (entry === undefined) return SecretState.Missing;

    return (await decrypt(entry)) === undefined
      ? SecretState.Unreadable
      : SecretState.Saved;
  }

  async function save(secret: SecretKey, value: string) {
    if (!(await cipher.isAvailable())) {
      throw new Error("This system has no secure storage to save secrets in");
    }

    const encrypted = (await cipher.encrypt(value)).toString("base64");

    await update((entries) => ({ ...entries, [secret]: encrypted }));
  }

  return {
    available: () => cipher.isAvailable(),

    save,

    delete: (secret: SecretKey) => update((entries) => omit(entries, [secret])),

    /** The decrypted value, or `undefined` when it is missing or unreadable. */
    async get(secret: SecretKey): Promise<string | undefined> {
      const entry = (await read())[secret];
      const decrypted = entry === undefined ? undefined : await decrypt(entry);

      if (decrypted?.shouldReEncrypt) {
        try {
          await save(secret, decrypted.plainText);
        } catch {
          // Best effort: the current ciphertext still decrypts with the previous key.
        }
      }

      return decrypted?.plainText;
    },

    /** The keys saved, without decrypting anything. */
    saved: async (): Promise<string[]> => Object.keys(await read()),

    /** One secret's state, decrypting only it. */
    state: async (secret: SecretKey): Promise<SecretState> =>
      stateOf((await read())[secret]),

    async states(): Promise<Record<Secret, SecretState>> {
      const entries = await read();
      const secrets = Object.values(Secret);

      return zipObject(
        secrets,
        await Promise.all(secrets.map((secret) => stateOf(entries[secret])))
      );
    },
  };
}

export type SecretStore = ReturnType<typeof createSecretStore>;
