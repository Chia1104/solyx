import { Mutex, omit, zipObject } from "es-toolkit";
import * as z from "zod";

import { readJson, writeFileAtomic } from "@solyx/utils/server";

import { Secret, SecretState } from "#shared/settings.ts";
import type { SecretKey } from "#shared/settings.ts";

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

/** Saved secrets as one file of ciphertext; values are decrypted only in the main process, on demand. */
export function createSecretStore(file: string, cipher: SecretCipher) {
  // A save reads, changes and rewrites the file, so saves run one at a time.
  const mutex = new Mutex();
  const listeners = new Set<(secret: SecretKey) => void>();

  function changed(secret: SecretKey) {
    for (const listener of listeners) listener(secret);
  }

  // Nothing in a file that no longer parses can be decrypted, so the next save replaces it.
  const read = async (): Promise<SecretFile> =>
    (await readJson(file, secretFileSchema)) ?? {};

  async function update(change: (entries: SecretFile) => SecretFile) {
    await mutex.acquire();

    try {
      await writeFileAtomic(file, JSON.stringify(change(await read())), {
        mode: 0o600,
      });
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

  async function store(secret: SecretKey, value: string) {
    if (!(await cipher.isAvailable())) {
      throw new Error("This system has no secure storage to save secrets in");
    }

    const encrypted = (await cipher.encrypt(value)).toString("base64");

    await update((entries) => ({ ...entries, [secret]: encrypted }));
  }

  return {
    available: () => cipher.isAvailable(),

    async save(secret: SecretKey, value: string) {
      await store(secret, value);
      changed(secret);
    },

    async delete(secret: SecretKey) {
      await update((entries) => omit(entries, [secret]));
      changed(secret);
    },

    /** Calls `listener` after each save or delete, so whoever reads a secret can follow it. */
    onChange(listener: (secret: SecretKey) => void): () => void {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },

    /** The decrypted value, or `undefined` when it is missing or unreadable. */
    async get(secret: SecretKey): Promise<string | undefined> {
      const entry = (await read())[secret];
      const decrypted = entry === undefined ? undefined : await decrypt(entry);

      // The value stays the same, so nobody hears about it.
      if (decrypted?.shouldReEncrypt) {
        try {
          await store(secret, decrypted.plainText);
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
