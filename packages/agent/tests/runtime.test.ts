import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { MemoryStorage, defineExtension } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";

import { AgentThinking } from "../src/providers.ts";
import { createAgentRuntime } from "../src/runtime.ts";
import type { AgentConversationStore } from "../src/runtime.ts";
import {
  AgentEventType,
  RunEndReason,
  ToolCallStatus,
  foldEvents,
} from "../src/wire.ts";
import type { AgentWireEvent } from "../src/wire.ts";

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "solyx-runtime-"));
});

afterEach(() => rm(directory, { recursive: true, force: true }));

function memoryStore(): AgentConversationStore {
  return {
    storage: new MemoryStorage(),
    deleteConversation: vi.fn(async () => undefined),
  };
}

function setup({
  store = memoryStore(),
  faux = fauxProvider(),
}: {
  store?: AgentConversationStore;
  faux?: ReturnType<typeof fauxProvider>;
} = {}) {
  const models = createModels();

  models.setProvider(faux.provider);

  const events: AgentWireEvent[] = [];
  const watchlist = vi.fn(() => "TW 2330");

  const runtime = createAgentRuntime({
    store: Promise.resolve(store),
    models,
    model: async () => ({
      model: faux.getModel(),
      thinking: AgentThinking.Off,
    }),
    extensions: async () => [
      defineExtension({
        name: "test",
        tools: [
          {
            name: "get_watchlist",
            description: "The watchlist",
            parameters: { type: "object", properties: {} },
            replay: "safe",
            execute: async () => ({
              content: [{ type: "text", text: watchlist() }],
              details: { count: 1 },
            }),
          },
        ],
      }),
    ],
    onEvent: (_sessionId, event) => events.push(event),
  });

  /** Resolves once `count` runs have ended. */
  const ended = (count = 1) =>
    vi.waitFor(() =>
      expect(
        events.filter((event) => event.type === AgentEventType.RunEnd)
      ).toHaveLength(count)
    );

  return { faux, store, events, runtime, watchlist, ended };
}

test("a run stores every message and streams the same conversation it replays", async () => {
  const { faux, events, runtime, watchlist, ended } = setup();
  const { id } = await runtime.create();

  faux.setResponses([
    fauxAssistantMessage(fauxToolCall("get_watchlist", {}), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("You watch 2330."),
  ]);

  await runtime.send(id, { text: "What do I watch?", context: "time: now" });
  await ended();

  expect(watchlist).toHaveBeenCalledOnce();
  expect((await runtime.sessions())[0]).toMatchObject({
    id,
    title: "What do I watch?",
  });

  const live = foldEvents(events);

  expect(live.running).toBe(false);
  expect(live.items).toMatchObject([
    { kind: "user", text: "What do I watch?" },
    { kind: "assistant", text: "" },
    { kind: "tool", toolName: "get_watchlist", status: ToolCallStatus.Ok },
    { kind: "assistant", text: "You watch 2330." },
  ]);
  expect(foldEvents(await runtime.transcript(id)).items).toEqual(live.items);
  expect(events.at(-1)).toEqual({
    type: AgentEventType.RunEnd,
    reason: RunEndReason.Done,
  });

  await runtime.close();
});

test("the app's context reaches the model but not the thread", async () => {
  const { faux, runtime, ended } = setup();
  const { id } = await runtime.create();
  let seen = "";

  faux.setResponses([
    (context) => {
      seen = JSON.stringify(context.messages);

      return fauxAssistantMessage("ok");
    },
  ]);

  await runtime.send(id, { text: "hi", context: "viewing: TW 2330" });
  await ended();

  expect(seen).toContain("viewing: TW 2330");
  expect(foldEvents(await runtime.transcript(id)).items[0]).toMatchObject({
    kind: "user",
    text: "hi",
  });

  await runtime.close();
});

test("a provider error ends the run with its message", async () => {
  const { faux, events, runtime, ended } = setup();
  const { id } = await runtime.create();

  faux.setResponses([
    fauxAssistantMessage("", {
      stopReason: "error",
      errorMessage: "invalid x-api-key",
    }),
  ]);

  await runtime.send(id, { text: "hi", context: "" });
  await ended();

  expect(events.at(-1)).toEqual({
    type: AgentEventType.RunEnd,
    reason: RunEndReason.Error,
    error: "invalid x-api-key",
  });
  expect(foldEvents(await runtime.transcript(id)).items.at(-1)).toEqual({
    kind: "notice",
    reason: RunEndReason.Error,
    error: "invalid x-api-key",
  });

  await runtime.close();
});

test("one run per conversation at a time", async () => {
  const { faux, runtime, ended } = setup();
  const { id } = await runtime.create();

  faux.setResponses([
    async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));

      return fauxAssistantMessage("slow");
    },
  ]);

  await runtime.send(id, { text: "first", context: "" });
  await vi.waitFor(() => expect(faux.state.callCount).toBe(1));

  await expect(
    runtime.send(id, { text: "second", context: "" })
  ).rejects.toThrow("still answering");
  await ended();
  await runtime.close();
});

test("stopping a run keeps what streamed and ends it as aborted", async () => {
  const { faux, events, runtime, ended } = setup({
    faux: fauxProvider({ tokensPerSecond: 40 }),
  });

  const { id } = await runtime.create();

  faux.setResponses([fauxAssistantMessage("a long answer ".repeat(40))]);

  await runtime.send(id, { text: "hi", context: "" });
  await vi.waitFor(() =>
    expect(
      events.some((event) => event.type === AgentEventType.AssistantDelta)
    ).toBe(true)
  );
  await runtime.abort(id);
  await ended();

  expect(events.at(-1)).toEqual({
    type: AgentEventType.RunEnd,
    reason: RunEndReason.Aborted,
  });
  expect(foldEvents(await runtime.transcript(id)).items).toMatchObject([
    { kind: "user" },
    { kind: "assistant", text: expect.stringContaining("a long") },
    { kind: "notice", reason: RunEndReason.Aborted },
  ]);

  await runtime.close();
});

test("a model that is not set up rejects before anything is stored", async () => {
  const runtime = createAgentRuntime({
    store: Promise.resolve(memoryStore()),
    models: createModels(),
    model: async () => {
      throw new Error("Save an API key first");
    },
    extensions: async () => [],
    onEvent: vi.fn(),
  });

  const { id } = await runtime.create();

  await expect(runtime.send(id, { text: "hi", context: "" })).rejects.toThrow(
    "Save an API key first"
  );
  expect(await runtime.transcript(id)).toEqual([]);

  await runtime.close();
});

test("deleting a conversation stops its run before erasing it", async () => {
  const { faux, store, events, runtime } = setup({
    faux: fauxProvider({ tokensPerSecond: 40 }),
  });

  const { id } = await runtime.create();

  faux.setResponses([fauxAssistantMessage("a long answer ".repeat(40))]);

  await runtime.send(id, { text: "hi", context: "" });
  await runtime.delete(id);

  expect(events.at(-1)).toMatchObject({ reason: RunEndReason.Aborted });
  expect(store.deleteConversation).toHaveBeenCalledWith(Number(id));

  await runtime.close();
});

test("a run the app's exit cut off continues when the app starts again", async () => {
  const path = join(directory, "agent.sqlite");

  const fileStore = async (): Promise<AgentConversationStore> => ({
    storage: await openNodeSqliteStorage(path),
    deleteConversation: vi.fn(async () => undefined),
  });

  const first = setup({ store: await fileStore() });
  const { id } = await first.runtime.create();

  first.faux.setResponses([
    fauxAssistantMessage(fauxToolCall("get_watchlist", {}), {
      stopReason: "toolUse",
    }),
    // Still answering when the app quits, which cancels the request.
    (_context, options) =>
      new Promise((_resolve, reject) => {
        options?.signal?.addEventListener("abort", () =>
          reject(options.signal?.reason)
        );
      }),
  ]);

  await first.runtime.send(id, { text: "What do I watch?", context: "" });
  await vi.waitFor(() => expect(first.faux.state.callCount).toBe(2));
  await first.runtime.close();

  const second = setup({ store: await fileStore() });

  second.faux.setResponses([fauxAssistantMessage("You watch 2330.")]);

  await second.runtime.resume();
  await second.ended();

  expect(foldEvents(await second.runtime.transcript(id)).items).toMatchObject([
    { kind: "user", text: "What do I watch?" },
    { kind: "assistant" },
    { kind: "tool", toolName: "get_watchlist", status: ToolCallStatus.Ok },
    { kind: "assistant", text: "You watch 2330." },
  ]);

  await second.runtime.close();
});

test("a compacted conversation still shows every message once", async () => {
  const path = join(directory, "agent.sqlite");

  const open = async () => {
    // A tiny window, so the third request compacts the two runs before it.
    const faux = fauxProvider({
      models: [{ id: "faux-1", contextWindow: 3000 }],
    });

    const models = createModels();
    const events: AgentWireEvent[] = [];

    models.setProvider(faux.provider);

    const runtime = createAgentRuntime({
      store: Promise.resolve({
        storage: await openNodeSqliteStorage(path),
        deleteConversation: vi.fn(async () => undefined),
      }),
      models,
      model: async () => ({
        model: faux.getModel(),
        thinking: AgentThinking.Off,
      }),
      extensions: async () => [],
      onEvent: (_sessionId, event) => events.push(event),
      settings: {
        compaction: {
          reserveTokens: 1000,
          keepRecentTokens: 1,
          backgroundTokens: 0,
        },
      },
    });

    const ended = (count: number) =>
      vi.waitFor(() =>
        expect(
          events.filter((event) => event.type === AgentEventType.RunEnd)
        ).toHaveLength(count)
      );

    return { faux, runtime, ended };
  };

  const first = await open();
  const { id } = await first.runtime.create();
  const long = "word ".repeat(1500);

  first.faux.setResponses([
    fauxAssistantMessage(`one ${long}`),
    fauxAssistantMessage(`two ${long}`),
  ]);
  await first.runtime.send(id, { text: "first", context: "" });
  await first.ended(1);
  await first.runtime.send(id, { text: "second", context: "" });
  await first.ended(2);
  await first.runtime.close();

  const second = await open();

  second.faux.setResponses([
    fauxAssistantMessage("The user asked twice."),
    fauxAssistantMessage("three"),
  ]);
  await second.runtime.send(id, { text: "third", context: "" });
  await second.ended(1);

  // The summary came first, then the answer.
  expect(second.faux.state.callCount).toBe(2);

  await second.runtime.close();

  // The next session finds the summary heading what the model sees.
  const third = await open();

  third.faux.setResponses([fauxAssistantMessage("four")]);
  await third.runtime.send(id, { text: "fourth", context: "" });
  await third.ended(1);

  const users = foldEvents(await third.runtime.transcript(id)).items.flatMap(
    (item) => (item.kind === "user" ? [item.text] : [])
  );

  expect(users).toEqual(["first", "second", "third", "fourth"]);

  await third.runtime.close();
});
