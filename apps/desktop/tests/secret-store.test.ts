import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";

import { Secret, SecretState } from "#shared/ipc/settings.ts";

import { createSecretStore } from "../src/main/modules/settings/secret-store.ts";
import type { SecretCipher } from "../src/main/modules/settings/secret-store.ts";

const KEY = "fugle-test-key-1234";

/** Tags ciphertext with a key id and reverses the text, so plain text never appears on disk. */
function fakeCipher() {
  const os = {
    available: true,
    keyId: "k1",
    /** Key ids that still decrypt but ask for re-encryption. */
    retiredKeyIds: new Set<string>(),
  };

  const cipher: SecretCipher = {
    isAvailable: async () => os.available,
    encrypt: async (plainText) =>
      Buffer.from(`${os.keyId}:${[...plainText].toReversed().join("")}`),
    decrypt: async (encrypted) => {
      const [keyId, body] = encrypted.toString().split(":");

      if (keyId !== os.keyId && !os.retiredKeyIds.has(keyId)) {
        throw new Error("Unknown key");
      }

      return {
        plainText: [...body].toReversed().join(""),
        shouldReEncrypt: keyId !== os.keyId,
      };
    },
  };

  return { os, cipher };
}

let directory: string;

let file: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "solyx-secrets-"));
  file = join(directory, "secrets.json");
});

afterEach(() => rm(directory, { recursive: true, force: true }));

describe("createSecretStore", () => {
  test("saved keys decrypt on demand and never reach the disk as plain text", async () => {
    const store = createSecretStore(file, fakeCipher().cipher);

    await store.save(Secret.FugleApiKey, KEY);

    expect(await store.get(Secret.FugleApiKey)).toBe(KEY);
    expect(await store.states()).toEqual({
      [Secret.FugleApiKey]: SecretState.Saved,
    });
    expect(await readFile(file, "utf8")).not.toContain(KEY);

    if (process.platform !== "win32") {
      expect((await stat(file)).mode & 0o777).toBe(0o600);
    }
  });

  test("a deleted key is missing", async () => {
    const store = createSecretStore(file, fakeCipher().cipher);

    await store.save(Secret.FugleApiKey, KEY);
    await store.delete(Secret.FugleApiKey);

    expect(await store.get(Secret.FugleApiKey)).toBeUndefined();
    expect(await store.states()).toEqual({
      [Secret.FugleApiKey]: SecretState.Missing,
    });
  });

  test("keys the OS can no longer decrypt are reported, not returned", async () => {
    const { os, cipher } = fakeCipher();
    const store = createSecretStore(file, cipher);

    await store.save(Secret.FugleApiKey, KEY);
    os.keyId = "k2";

    expect(await store.get(Secret.FugleApiKey)).toBeUndefined();
    expect(await store.states()).toEqual({
      [Secret.FugleApiKey]: SecretState.Unreadable,
    });
  });

  test("nothing is saved where the OS has no secret store", async () => {
    const { os, cipher } = fakeCipher();
    const store = createSecretStore(file, cipher);

    os.available = false;

    await expect(store.save(Secret.FugleApiKey, KEY)).rejects.toThrow();
    await expect(stat(file)).rejects.toThrow();
  });

  test("keys under a rotated OS key move to the new one when read", async () => {
    const { os, cipher } = fakeCipher();
    const store = createSecretStore(file, cipher);

    await store.save(Secret.FugleApiKey, KEY);
    os.retiredKeyIds.add("k1");
    os.keyId = "k2";

    expect(await store.get(Secret.FugleApiKey)).toBe(KEY);

    const [entry] = Object.values(JSON.parse(await readFile(file, "utf8")));

    expect(Buffer.from(String(entry), "base64").toString()).toMatch(/^k2:/);
  });

  test("a file that no longer parses is replaced by the next save", async () => {
    const store = createSecretStore(file, fakeCipher().cipher);

    await writeFile(file, "not json");

    expect(await store.states()).toEqual({
      [Secret.FugleApiKey]: SecretState.Missing,
    });

    await store.save(Secret.FugleApiKey, KEY);

    expect(await store.get(Secret.FugleApiKey)).toBe(KEY);
  });
});
