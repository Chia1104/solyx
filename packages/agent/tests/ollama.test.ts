import { Type, createModels } from "@earendil-works/pi-ai";
import type {
  AssistantMessageEvent,
  Context,
  CredentialStore,
  Model,
  Api,
} from "@earendil-works/pi-ai";
import { expect, test } from "vite-plus/test";

import { OLLAMA, createOllamaProvider } from "../src/ollama.ts";

const ENDPOINT = "http://127.0.0.1:11434";

interface Sent {
  url: string;
  authorization: string | null;
  body: unknown;
}

/** A body sent line by line, as Ollama streams a reply. */
function streamed(lines: object[]) {
  const encoder = new TextEncoder();

  return new Response(
    new ReadableStream({
      start(controller) {
        for (const line of lines) {
          controller.enqueue(encoder.encode(`${JSON.stringify(line)}\n`));
        }

        controller.close();
      },
    })
  );
}

const TAGS = {
  models: [
    {
      name: "qwen3.8:9b",
      capabilities: ["completion", "tools", "thinking"],
      details: { context_length: 262_144 },
    },
    {
      name: "gemma4:12b",
      capabilities: ["completion", "tools", "vision"],
      details: { context_length: 131_072 },
    },
    // An embedding model lists tools too, but does not chat.
    {
      name: "qwen3-embedding:0.6b",
      capabilities: ["tools", "thinking", "embedding"],
      details: { context_length: 32_768 },
    },
    {
      name: "llama2:7b",
      capabilities: ["completion"],
      details: { context_length: 4096 },
    },
    // Holds too little for the agent's prompt, tools and a conversation.
    {
      name: "qwen3:4b",
      capabilities: ["completion", "tools", "thinking"],
      details: { context_length: 40_960 },
    },
  ],
};

/** Ollama answering the listing with `TAGS` and every chat with `reply`, behind a proxy's key when one is saved. */
async function fakeOllama(
  reply: () => Response = () => streamed([]),
  key?: string
) {
  const sent: Sent[] = [];

  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);
    const text = await request.text();

    sent.push({
      url: request.url,
      authorization: request.headers.get("authorization"),
      body: text ? JSON.parse(text) : undefined,
    });

    return request.url.endsWith("/api/tags") ? Response.json(TAGS) : reply();
  };

  const credentials: CredentialStore = {
    read: async () => (key ? { type: "api_key", key } : undefined),
    list: async () => (key ? [{ providerId: OLLAMA, type: "api_key" }] : []),
    modify: async () => undefined,
    delete: async () => undefined,
  };

  const models = createModels({ credentials });

  models.setProvider(createOllamaProvider({ endpoint: () => ENDPOINT, fetch }));

  const { errors } = await models.refresh({ providers: [OLLAMA], force: true });

  expect(errors.size).toBe(0);

  return { sent, models };
}

function model(
  models: {
    getModel: (provider: string, id: string) => Model<Api> | undefined;
  },
  id: string
) {
  const found = models.getModel(OLLAMA, id);

  if (!found) throw new Error(`${id} is not listed`);

  return found;
}

const CONTEXT: Context = {
  systemPrompt: "You are Solyx's agent.",
  tools: [
    {
      name: "get_quotes",
      description: "The newest session of some listings.",
      parameters: Type.Object({ symbols: Type.Array(Type.String()) }),
    },
  ],
  messages: [
    { role: "user", content: "台積電今天如何？", timestamp: 1 },
    {
      role: "assistant",
      content: [
        { type: "thinking", thinking: "Read the quote first." },
        {
          type: "toolCall",
          id: "call_1",
          name: "get_quotes",
          arguments: { symbols: ["2330"] },
        },
      ],
      api: "ollama-chat",
      provider: OLLAMA,
      model: "qwen3.8:9b",
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "toolUse",
      timestamp: 2,
    },
    {
      role: "toolResult",
      toolCallId: "call_1",
      toolName: "get_quotes",
      content: [{ type: "text", text: "2330: 1,085 (+1.4%)" }],
      isError: false,
      timestamp: 3,
    },
  ],
};

async function events(stream: AsyncIterable<AssistantMessageEvent>) {
  const seen: AssistantMessageEvent[] = [];

  for await (const event of stream) seen.push(event);

  return seen;
}

test("only models that chat, call tools and hold the agent's prompt with room to spare are listed", async () => {
  const { sent, models } = await fakeOllama();

  expect(sent.map(({ url }) => url)).toEqual([`${ENDPOINT}/api/tags`]);
  expect(
    models.getModels(OLLAMA).map(({ id, reasoning, input, contextWindow }) => ({
      id,
      reasoning,
      input,
      contextWindow,
    }))
  ).toEqual([
    {
      id: "qwen3.8:9b",
      reasoning: true,
      input: ["text"],
      contextWindow: 65_536,
    },
    {
      id: "gemma4:12b",
      reasoning: false,
      input: ["text", "image"],
      contextWindow: 65_536,
    },
  ]);
});

test("a request asks for the whole window, refuses to drop messages and sends the conversation as Ollama's", async () => {
  const { sent, models } = await fakeOllama(
    () => streamed([{ message: { content: "好" }, done: true }]),
    "proxy-token"
  );

  await models
    .streamSimple(model(models, "qwen3.8:9b"), CONTEXT, { reasoning: "high" })
    .result();

  expect(sent[1].url).toBe(`${ENDPOINT}/api/chat`);
  expect(sent[1].authorization).toBe("Bearer proxy-token");
  expect(sent[1].body).toMatchObject({
    model: "qwen3.8:9b",
    stream: true,
    think: true,
    options: { num_ctx: 65_536, num_predict: 16_384 },
    truncate: false,
    shift: false,
    messages: [
      { role: "system", content: "You are Solyx's agent." },
      { role: "user", content: "台積電今天如何？" },
      {
        role: "assistant",
        content: "",
        thinking: "Read the quote first.",
        tool_calls: [
          {
            id: "call_1",
            function: { name: "get_quotes", arguments: { symbols: ["2330"] } },
          },
        ],
      },
      {
        role: "tool",
        tool_name: "get_quotes",
        tool_call_id: "call_1",
        content: "2330: 1,085 (+1.4%)",
      },
    ],
    tools: [
      {
        type: "function",
        function: {
          name: "get_quotes",
          description: "The newest session of some listings.",
          parameters: {
            type: "object",
            properties: {
              symbols: { type: "array", items: { type: "string" } },
            },
          },
        },
      },
    ],
  });
});

test("thinking is switched off when the conversation sets it off, and never sent to a model without it", async () => {
  const { sent, models } = await fakeOllama(() =>
    streamed([{ message: { content: "好" }, done: true }])
  );

  // A conversation with thinking off asks for no level.
  await models.streamSimple(model(models, "qwen3.8:9b"), CONTEXT).result();
  await models
    .streamSimple(model(models, "gemma4:12b"), CONTEXT, { reasoning: "high" })
    .result();

  expect(sent[1].body).toMatchObject({ think: false });
  expect(sent[2].body).not.toHaveProperty("think");
});

test("a reply streams its thinking, text and whole tool calls, and counts the cached prompt apart", async () => {
  const { models } = await fakeOllama(() =>
    streamed([
      { message: { thinking: "Quote " }, done: false },
      { message: { thinking: "it." }, done: false },
      { message: { content: "我查一下。" }, done: false },
      {
        message: {
          tool_calls: [
            {
              id: "call_9",
              function: {
                name: "get_quotes",
                arguments: { symbols: ["2330"] },
              },
            },
          ],
        },
        done: false,
      },
      {
        message: { content: "" },
        done: true,
        done_reason: "stop",
        prompt_eval_count: 18_200,
        prompt_eval_cached_count: 18_000,
        eval_count: 40,
      },
    ])
  );

  const stream = models.streamSimple(model(models, "qwen3.8:9b"), CONTEXT, {
    reasoning: "medium",
  });

  expect((await events(stream)).map(({ type }) => type)).toEqual([
    "start",
    "thinking_start",
    "thinking_delta",
    "thinking_delta",
    "thinking_end",
    "text_start",
    "text_delta",
    "text_end",
    "toolcall_start",
    "toolcall_delta",
    "toolcall_end",
    "done",
  ]);

  const message = await stream.result();

  expect(message.stopReason).toBe("toolUse");
  expect(message.content).toEqual([
    { type: "thinking", thinking: "Quote it." },
    { type: "text", text: "我查一下。" },
    {
      type: "toolCall",
      id: "call_9",
      name: "get_quotes",
      arguments: { symbols: ["2330"] },
    },
  ]);
  expect(message.usage).toMatchObject({
    input: 200,
    cacheRead: 18_000,
    output: 40,
    totalTokens: 18_240,
  });
});

test("a reply that fails names Ollama's host and the reason it gives, in its status or its last line", async () => {
  const midway = await fakeOllama(() =>
    streamed([
      { message: { content: "我" }, done: false },
      { error: "an error was encountered while running the model" },
    ])
  );

  const cut = await midway.models
    .streamSimple(model(midway.models, "gemma4:12b"), CONTEXT)
    .result();

  expect(cut.stopReason).toBe("error");
  expect(cut.errorMessage).toBe(
    "127.0.0.1:11434: an error was encountered while running the model"
  );

  const gone = await fakeOllama(() =>
    Response.json({ error: 'model "gemma4:12b" not found' }, { status: 404 })
  );

  const refused = await gone.models
    .streamSimple(model(gone.models, "gemma4:12b"), CONTEXT)
    .result();

  expect(refused.errorMessage).toBe(
    '127.0.0.1:11434 answered 404: model "gemma4:12b" not found'
  );
});
