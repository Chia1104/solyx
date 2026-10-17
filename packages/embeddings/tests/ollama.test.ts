import { noop } from "es-toolkit";
import { expect, test } from "vite-plus/test";

import { createOllama } from "../src/ollama.ts";
import type { PullProgress } from "../src/ollama.ts";

const BASE_URL = "http://127.0.0.1:11434/v1";

/** A body sent in pieces that cut lines apart, as a stream may. */
function streamed(pieces: string[]) {
  const encoder = new TextEncoder();

  return new Response(
    new ReadableStream({
      start(controller) {
        for (const piece of pieces) controller.enqueue(encoder.encode(piece));
        controller.close();
      },
    })
  );
}

function fakeOllama(
  answer: (request: Request) => Response | Promise<Response>
) {
  const sent: { url: string; body: string }[] = [];

  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);

    sent.push({ url: request.url, body: await request.clone().text() });

    return answer(request);
  };

  return { sent, ollama: createOllama({ baseURL: BASE_URL, fetch }) };
}

const listing = (...ids: string[]) =>
  Response.json({
    object: "list",
    data: ids.map((id) => ({ id, object: "model", owned_by: "library" })),
  });

test("a model is there once OpenAI's listing names it, a name without a tag by its latest", async () => {
  const { sent, ollama } = fakeOllama(() =>
    listing("qwen3-embedding:0.6b", "nomic-embed-text:latest")
  );

  expect(await ollama.has("qwen3-embedding:0.6b")).toBe(true);
  expect(await ollama.has("nomic-embed-text")).toBe(true);
  expect(await ollama.has("qwen3-embedding:4b")).toBe(false);
  expect(sent[0].url).toBe(`${BASE_URL}/models`);
});

test("nothing answering reads as unknown, while a server's failure names it", async () => {
  const closed = fakeOllama(() => {
    throw new TypeError("fetch failed");
  });

  expect(await closed.ollama.has("qwen3-embedding:0.6b")).toBeNull();
  expect(closed.sent).toHaveLength(1);

  const failing = fakeOllama(() =>
    Response.json(
      { error: { message: "model store unreadable" } },
      { status: 500 }
    )
  );

  await expect(failing.ollama.has("qwen3-embedding:0.6b")).rejects.toThrow(
    "127.0.0.1:11434 answered 500: model store unreadable"
  );
});

test("a pull asks Ollama's own API and counts every layer's bytes until it is written", async () => {
  const { sent, ollama } = fakeOllama(() =>
    streamed([
      '{"status":"pulling manifest"}\n{"status":"pulling a","digest":"sha256:a","total":1000,"compl',
      'eted":250}\n{"status":"pulling a","digest":"sha256:a","total":1000,"completed":1000}\n',
      '{"status":"pulling b","digest":"sha256:b","total":10,"completed":10}\n',
      '{"status":"verifying sha256 digest"}\n{"status":"success"}\n',
    ])
  );

  const progress: PullProgress[] = [];

  await ollama.pull("qwen3-embedding:0.6b", (each) => progress.push(each));

  expect(sent).toEqual([
    {
      url: "http://127.0.0.1:11434/api/pull",
      body: JSON.stringify({ model: "qwen3-embedding:0.6b" }),
    },
  ]);
  expect(progress).toEqual([
    { completed: 250, total: 1000 },
    { completed: 1000, total: 1000 },
    { completed: 1010, total: 1010 },
  ]);
});

test("a pull fails with the reason Ollama gives, whether in its status or its last line", async () => {
  const unknown = fakeOllama(() =>
    streamed([
      '{"status":"pulling manifest"}\n',
      '{"error":"pull model manifest: file does not exist"}\n',
    ])
  );

  await expect(unknown.ollama.pull("no-such-model", noop)).rejects.toThrow(
    "127.0.0.1:11434: pull model manifest: file does not exist"
  );

  const refused = fakeOllama(() =>
    Response.json({ error: "invalid model name" }, { status: 400 })
  );

  await expect(refused.ollama.pull("bad name", noop)).rejects.toThrow(
    "127.0.0.1:11434 answered 400: invalid model name"
  );
});

test("a pull cut off before Ollama writes the model fails", async () => {
  const { ollama } = fakeOllama(() =>
    streamed([
      '{"status":"pulling a","digest":"sha256:a","total":1000,"completed":250}\n',
    ])
  );

  await expect(ollama.pull("qwen3-embedding:0.6b", noop)).rejects.toThrow(
    "127.0.0.1:11434 stopped before qwen3-embedding:0.6b was written"
  );
});
