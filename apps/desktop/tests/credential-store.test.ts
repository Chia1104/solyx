import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { OAuthCredential } from "@earendil-works/pi-ai";
import { afterEach, beforeEach, expect, test } from "vite-plus/test";

import { AgentProvider } from "@solyx/agent/providers";

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

const open = () =>
  createCredentialStore(createSecretStore(secretsFile, fakeCipher().cipher));

test("a sign-in is kept encrypted with the fields its flow added", async () => {
  const store = open();

  await store.modify(AgentProvider.OpenAI, async () => SIGN_IN);

  expect(await open().read(AgentProvider.OpenAI)).toEqual(SIGN_IN);
  expect(await store.list()).toEqual([
    { providerId: AgentProvider.OpenAI, type: "oauth" },
  ]);
  expect(await readFile(secretsFile, "utf8")).not.toContain("access-token");
});

test("a refresh sees the stored sign-in and replaces it", async () => {
  const store = open();

  await store.modify(AgentProvider.OpenAI, async () => SIGN_IN);

  const refreshed = await store.modify(AgentProvider.OpenAI, async (current) =>
    current?.type === "oauth" ? { ...current, access: "rotated" } : current
  );

  expect(refreshed).toEqual({ ...SIGN_IN, access: "rotated" });
  expect(await store.read(AgentProvider.OpenAI)).toEqual(refreshed);
});

test("clearing or deleting a sign-in removes it", async () => {
  const store = open();

  await store.modify(AgentProvider.OpenAI, async () => SIGN_IN);
  await store.modify(AgentProvider.OpenAI, async () => undefined);

  expect(await store.read(AgentProvider.OpenAI)).toBeUndefined();

  await store.modify(AgentProvider.OpenAI, async () => SIGN_IN);
  await store.delete(AgentProvider.OpenAI);

  expect(await store.list()).toEqual([]);
});

test("API keys are not stored as sign-ins", async () => {
  const store = open();

  await expect(
    store.modify(AgentProvider.OpenAI, async () => ({
      type: "api_key",
      key: "sk-test",
    }))
  ).rejects.toThrow("Only subscription sign-ins");
  expect(await store.read(AgentProvider.OpenAI)).toBeUndefined();
});

test("a provider without a subscription sign-in has nothing stored", async () => {
  const store = open();

  expect(await store.read(AgentProvider.Anthropic)).toBeUndefined();
  await expect(
    store.modify(AgentProvider.Anthropic, async () => SIGN_IN)
  ).rejects.toThrow("no subscription sign-in");
});

test("the installation id is created once and kept", async () => {
  const file = join(directory, "installation-id");
  const id = installationId(file)();

  expect(id).toMatch(/^[0-9a-f-]{36}$/);
  expect(installationId(file)()).toBe(id);

  await writeFile(file, "not an id");

  expect(installationId(file)()).not.toBe(id);
});
