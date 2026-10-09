import { expect, test } from "vite-plus/test";

import { createOpenAICompatibleEmbedder } from "../src/openai-compatible.ts";
import type { OpenAICompatibleOptions } from "../src/openai-compatible.ts";

interface Sent {
  url: string;
  authorization: string | null;
  body: { model: string; input: string[]; dimensions?: number };
}

/** Answers each request with vectors whose first number is the text's length, out of order, as a server may. */
function fakeServer(
  options: Partial<OpenAICompatibleOptions> = {},
  failure?: { status: number; body: unknown }
) {
  const sent: Sent[] = [];

  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);
    const body: Sent["body"] = JSON.parse(await request.text());

    sent.push({
      url: request.url,
      authorization: request.headers.get("authorization"),
      body,
    });

    if (failure) return Response.json(failure.body, { status: failure.status });

    return Response.json({
      data: body.input
        .map((text, index) => ({ index, embedding: [text.length, 1] }))
        .toReversed(),
    });
  };

  const embedder = createOpenAICompatibleEmbedder({
    baseURL: "https://api.openai.com/v1",
    model: "text-embedding-3-small",
    dimensions: 512,
    apiKey: "test-key",
    fetch,
    ...options,
  });

  return { sent, embedder };
}

test("texts go in batches with the model and length asked, and come back in their order", async () => {
  const { sent, embedder } = fakeServer();

  const texts = Array.from({ length: 70 }, (_, index) =>
    "字".repeat(index + 1)
  );

  const vectors = await embedder.embed(texts);

  expect(embedder.space).toBe("text-embedding-3-small/512");
  expect(vectors.map((vector) => vector[0])).toEqual(
    texts.map((text) => text.length)
  );
  expect(vectors[0]).toBeInstanceOf(Float32Array);
  expect(sent.map(({ body }) => body.input.length)).toEqual([64, 6]);
  expect(sent[0]).toMatchObject({
    url: "https://api.openai.com/v1/embeddings",
    authorization: "Bearer test-key",
    body: { model: "text-embedding-3-small", dimensions: 512 },
  });
});

test("a local server takes no key and keeps the model's own length", async () => {
  const { sent, embedder } = fakeServer({
    baseURL: "http://127.0.0.1:11434/v1/",
    model: "qwen3-embedding:0.6b",
    dimensions: null,
    apiKey: undefined,
  });

  await embedder.embed(["台積電法說會"]);

  expect(embedder.space).toBe("qwen3-embedding:0.6b");
  expect(sent[0].url).toBe("http://127.0.0.1:11434/v1/embeddings");
  expect(sent[0].authorization).toBeNull();
  expect(sent[0].body).not.toHaveProperty("dimensions");
});

test("a failure names the server and the reason it gives", async () => {
  await expect(
    fakeServer(
      {},
      { status: 401, body: { error: { message: "Incorrect API key" } } }
    ).embedder.embed(["a"])
  ).rejects.toThrow("api.openai.com answered 401: Incorrect API key");

  await expect(
    fakeServer(
      { baseURL: "http://127.0.0.1:11434/v1", apiKey: undefined },
      { status: 404, body: { error: 'model "bge-m3" not found' } }
    ).embedder.embed(["a"])
  ).rejects.toThrow('127.0.0.1:11434 answered 404: model "bge-m3" not found');
});

test("nothing to embed asks nothing", async () => {
  const { sent, embedder } = fakeServer();

  expect(await embedder.embed([])).toEqual([]);
  expect(sent).toEqual([]);
});
