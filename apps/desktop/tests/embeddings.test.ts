import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, expect, test } from "vite-plus/test";

import { EmbeddingsProvider } from "@solyx/embeddings/provider";

import { Secret } from "#shared/ipc/settings.ts";

import { createEmbeddings } from "../src/main/modules/embeddings/embeddings.ts";
import { createConfigFile } from "../src/main/modules/settings/config-file.ts";
import { createSecretStore } from "../src/main/modules/settings/secret-store.ts";

import { fakeCipher } from "./fake-cipher.ts";

let home: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "solyx-embeddings-"));
});

afterEach(() => rm(home, { recursive: true, force: true }));

function setup() {
  const config = createConfigFile(join(home, ".solyx", "config.json"));

  config.create();

  const secrets = createSecretStore(
    join(home, "data", "secrets.json"),
    fakeCipher().cipher
  );

  return { config, secrets, embeddings: createEmbeddings({ config, secrets }) };
}

test("news groups by titles alone until the user switches embeddings on", async () => {
  const { config, embeddings } = setup();

  expect(embeddings.settings()).toEqual({
    enabled: false,
    provider: EmbeddingsProvider.Local,
    space: "qwen3-embedding:0.6b",
    measured: true,
  });
  expect(await embeddings.embedder()).toBeUndefined();

  config.set(["embeddings", "enabled"], true);

  expect((await embeddings.embedder())?.space).toBe("qwen3-embedding:0.6b");
});

test("OpenAI's embeddings wait for their own key", async () => {
  const { config, secrets, embeddings } = setup();

  config.set(["embeddings", "enabled"], true);
  config.set(["embeddings", "provider"], EmbeddingsProvider.OpenAI);

  expect(await embeddings.embedder()).toBeUndefined();

  await secrets.save(Secret.EmbeddingsApiKey, "sk-test");

  expect((await embeddings.embedder())?.space).toBe(
    "text-embedding-3-large/1024"
  );
  expect(embeddings.settings()).toMatchObject({ measured: true });
});

test("the user's own text is embedded only by a model on this computer", async () => {
  const { config, secrets, embeddings } = setup();

  expect(embeddings.localEmbedder()).toBeUndefined();

  config.set(["embeddings", "enabled"], true);

  expect(embeddings.localEmbedder()?.space).toBe("qwen3-embedding:0.6b");

  config.set(["embeddings", "provider"], EmbeddingsProvider.OpenAI);
  await secrets.save(Secret.EmbeddingsApiKey, "sk-test");

  expect(await embeddings.embedder()).toBeDefined();
  expect(embeddings.localEmbedder()).toBeUndefined();
});
