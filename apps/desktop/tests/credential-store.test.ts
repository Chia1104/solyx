import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { OAuthCredential } from "@earendil-works/pi-ai";
import { afterEach, beforeEach, expect, test } from "vite-plus/test";

import { agentKeySecret } from "#shared/ipc/settings.ts";

import { createCredentialStore } from "../src/main/modules/settings/credential-store.ts";
import { installationId } from "../src/main/modules/settings/installation-id.ts";
import { createSecretStore } from "../src/main/modules/settings/secret-store.ts";

import { fakeCipher } from "./fake-cipher.ts";

const SIGN_IN: OAuthCredential = {
  type: "oauth",
  access: "access-token",
  refresh: "refresh-token",
  expires: 1_900_000_000_000,
  clientId: "issued-client",
};

let directory: string;

let secretsFile: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "solyx-credentials-"));
  secretsFile = join(directory, "secrets.json");
});

afterEach(() => rm(directory, { recursive: true, force: true }));

const secretsAt = () => createSecretStore(secretsFile, fakeCipher().cipher);

/** A store whose providers run on their subscription, or on their key with `onKeys`. */
const open = (onKeys = false) =>
  createCredentialStore(secretsAt(), () => !onKeys);

test("a sign-in is kept encrypted with the fields its flow added", async () => {
  const store = open();

  await store.modify("openai", async () => SIGN_IN);

  expect(await open().read("openai")).toEqual(SIGN_IN);
  expect(await store.stored("openai")).toBe("oauth");
  expect(await readFile(secretsFile, "utf8")).not.toContain("access-token");
});

test("a refresh sees the stored sign-in and replaces it", async () => {
  const store = open();

  await store.modify("openai", async () => SIGN_IN);

  const refreshed = await store.modify("openai", async (current) =>
    current?.type === "oauth" ? { ...current, access: "rotated" } : current
  );

  expect(refreshed).toEqual({ ...SIGN_IN, access: "rotated" });
  expect(await store.read("openai")).toEqual(refreshed);
});

test("a change that returns nothing leaves the sign-in, and signing out removes it", async () => {
  const store = open();

  await store.modify("openai", async () => SIGN_IN);

  // pi-ai's refresh returns nothing once another request has refreshed the token.
  expect(await store.modify("openai", async () => undefined)).toEqual(SIGN_IN);
  expect(await store.read("openai")).toEqual(SIGN_IN);

  await store.delete("openai");

  expect(await store.stored("openai")).toBeUndefined();
});

test("a provider on its key reads the key saved in Settings", async () => {
  await secretsAt().save(agentKeySecret("openai"), "sk-test");

  const store = open(true);

  await store.modify("openai", async () => SIGN_IN);

  expect(await store.read("openai")).toEqual({
    type: "api_key",
    key: "sk-test",
  });
  expect(await store.stored("openai")).toBe("api_key");
  expect(await store.signedIn("openai")).toBe(true);
});

test("API keys are not stored as sign-ins", async () => {
  const store = open();

  await expect(
    store.modify("openai", async () => ({
      type: "api_key",
      key: "sk-test",
    }))
  ).rejects.toThrow("Only subscription sign-ins");
  expect(await store.read("openai")).toBeUndefined();
});

test("a provider without a subscription sign-in has nothing stored", async () => {
  const store = open(true);

  expect(await store.read("anthropic")).toBeUndefined();
  await expect(store.modify("anthropic", async () => SIGN_IN)).rejects.toThrow(
    "no subscription sign-in"
  );
});

test("the installation id is created once and kept", async () => {
  const file = join(directory, "installation-id");
  const id = installationId(file)();

  expect(id).toMatch(/^[0-9a-f-]{36}$/);
  expect(installationId(file)()).toBe(id);

  await writeFile(file, "not an id");

  expect(installationId(file)()).not.toBe(id);
});
