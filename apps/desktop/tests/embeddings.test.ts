import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";

import { EmbeddingsProvider } from "@solyx/embeddings/provider";

import { LocalModelStatus } from "#shared/embeddings.ts";
import { Secret } from "#shared/settings.ts";

import { createEmbeddings } from "../src/main/modules/embeddings/embeddings.ts";
import { createConfigFile } from "../src/main/modules/settings/config-file.ts";
import { createSecretStore } from "../src/main/modules/settings/secret-store.ts";

import { fakeCipher } from "./fake-cipher.ts";

let home: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "solyx-embeddings-"));
});

afterEach(() => rm(home, { recursive: true, force: true }));

/** A line of Ollama's pull: a layer's bytes so far, a step, or why it stopped. */
interface PullLine {
  status?: string;
  digest?: string;
  total?: number;
  completed?: number;
  error?: string;
}

/** Ollama holding `held`, whose pulls the test feeds line by line. */
function fakeOllama() {
  const held = new Set<string>();
  const encoder = new TextEncoder();
  let pull: ReadableStreamDefaultController<Uint8Array> | undefined;

  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);

    if (request.url === "http://127.0.0.1:11434/v1/models") {
      return Response.json({ data: [...held].map((id) => ({ id })) });
    }

    return new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          pull = controller;
        },
      })
    );
  };

  return {
    fetch,
    held,
    pulling: () => pull !== undefined,
    send(line: PullLine) {
      pull?.enqueue(encoder.encode(`${JSON.stringify(line)}\n`));
    },
    end() {
      pull?.close();
      pull = undefined;
    },
  };
}

function setup(fetch?: typeof globalThis.fetch) {
  const config = createConfigFile(join(home, ".solyx", "config.json"));

  config.create();

  const secrets = createSecretStore(
    join(home, "data", "secrets.json"),
    fakeCipher().cipher
  );

  const diagnostics = { recovered: vi.fn() };
  const onChange = vi.fn();

  return {
    config,
    secrets,
    diagnostics,
    onChange,
    embeddings: createEmbeddings({
      config,
      secrets,
      diagnostics,
      onChange,
      fetch,
    }),
  };
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

test("a missing model on this computer pulls once, however often it is asked, and is then ready", async () => {
  const ollama = fakeOllama();
  const { embeddings, onChange } = setup(ollama.fetch);
  const model = "qwen3-embedding:0.6b";

  expect(await embeddings.localModel()).toEqual({
    status: LocalModelStatus.Missing,
    model,
    failure: null,
  });

  embeddings.pullLocalModel();
  embeddings.pullLocalModel();

  expect(onChange).toHaveBeenCalledOnce();
  expect(await embeddings.localModel()).toEqual({
    status: LocalModelStatus.Pulling,
    model,
    completed: 0,
    total: 0,
  });

  await vi.waitUntil(ollama.pulling);
  ollama.send({
    status: "pulling a",
    digest: "sha256:a",
    total: 1000,
    completed: 250,
  });

  await vi.waitFor(async () =>
    expect(await embeddings.localModel()).toMatchObject({
      status: LocalModelStatus.Pulling,
      completed: 250,
      total: 1000,
    })
  );

  ollama.held.add(model);
  ollama.send({ status: "success" });
  ollama.end();

  await vi.waitFor(async () =>
    expect(await embeddings.localModel()).toEqual({
      status: LocalModelStatus.Ready,
      model,
    })
  );
});

test("a failed pull leaves the model missing with Ollama's reason, until the next pull", async () => {
  const ollama = fakeOllama();
  const { embeddings, diagnostics } = setup(ollama.fetch);

  embeddings.pullLocalModel();

  await vi.waitUntil(ollama.pulling);
  ollama.send({ error: "pull model manifest: file does not exist" });

  await vi.waitFor(async () =>
    expect(await embeddings.localModel()).toMatchObject({
      status: LocalModelStatus.Missing,
      failure: "127.0.0.1:11434: pull model manifest: file does not exist",
    })
  );
  expect(diagnostics.recovered).toHaveBeenCalledWith(
    expect.any(Error),
    "embeddings.pull",
    { model: "qwen3-embedding:0.6b" }
  );

  embeddings.pullLocalModel();

  expect(await embeddings.localModel()).toMatchObject({
    status: LocalModelStatus.Pulling,
  });
});

test("the model the local settings name is looked for even while OpenAI's are picked", async () => {
  const { config, embeddings } = setup(async () => {
    throw new TypeError("fetch failed");
  });

  config.set(["embeddings", "provider"], EmbeddingsProvider.OpenAI);

  expect(await embeddings.localModel()).toEqual({
    status: LocalModelStatus.Unreachable,
    model: "qwen3-embedding:0.6b",
    host: "127.0.0.1:11434",
  });
});
