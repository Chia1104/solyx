import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";

import { Secret, SecretState } from "#shared/ipc/settings.ts";

import { createSecretStore } from "../src/main/modules/settings/secret-store.ts";

import { fakeCipher } from "./fake-cipher.ts";

const KEY = "fugle-test-key-1234";

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
      ...Object.fromEntries(
        Object.values(Secret).map((secret) => [secret, SecretState.Missing])
      ),
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
    expect(await store.states()).toMatchObject({
      [Secret.FugleApiKey]: SecretState.Missing,
    });
  });

  test("keys the OS can no longer decrypt are reported, not returned", async () => {
    const { os, cipher } = fakeCipher();
    const store = createSecretStore(file, cipher);

    await store.save(Secret.FugleApiKey, KEY);
    os.keyId = "k2";

    expect(await store.get(Secret.FugleApiKey)).toBeUndefined();
    expect(await store.states()).toMatchObject({
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

  test("keys under a rotated OS key move to the new one when read, which changes nothing anyone reads", async () => {
    const { os, cipher } = fakeCipher();
    const store = createSecretStore(file, cipher);
    const changed: string[] = [];

    await store.save(Secret.FugleApiKey, KEY);
    store.onChange((secret) => changed.push(secret));
    os.retiredKeyIds.add("k1");
    os.keyId = "k2";

    expect(await store.get(Secret.FugleApiKey)).toBe(KEY);

    const [entry] = Object.values(JSON.parse(await readFile(file, "utf8")));

    expect(Buffer.from(String(entry), "base64").toString()).toMatch(/^k2:/);
    expect(changed).toEqual([]);
  });

  test("saves and deletes are reported once written", async () => {
    const store = createSecretStore(file, fakeCipher().cipher);
    const changed: { secret: string; saved: string[] }[] = [];

    store.onChange((secret) => {
      changed.push({
        secret,
        saved: Object.keys(JSON.parse(readFileSync(file, "utf8"))),
      });
    });

    await store.save(Secret.FugleApiKey, KEY);
    await store.delete(Secret.FugleApiKey);

    expect(changed).toEqual([
      { secret: Secret.FugleApiKey, saved: [Secret.FugleApiKey] },
      { secret: Secret.FugleApiKey, saved: [] },
    ]);
  });

  test("a file that no longer parses is replaced by the next save", async () => {
    const store = createSecretStore(file, fakeCipher().cipher);

    await writeFile(file, "not json");

    expect(await store.states()).toMatchObject({
      [Secret.FugleApiKey]: SecretState.Missing,
    });

    await store.save(Secret.FugleApiKey, KEY);

    expect(await store.get(Secret.FugleApiKey)).toBe(KEY);
  });
});
