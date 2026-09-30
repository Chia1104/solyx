import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { expect, test, vi } from "vite-plus/test";

import { AgentThinking } from "../src/providers.ts";
import { createAgentRuntime } from "../src/runtime.ts";
import type { AgentSessionStore, TranscriptEntry } from "../src/transcript.ts";
import type { AgentSession } from "../src/transcript.ts";
import {
  AgentEventType,
  RunEndReason,
  ToolCallStatus,
  foldEvents,
} from "../src/wire.ts";
import type { AgentWireEvent } from "../src/wire.ts";

function memoryStore(): AgentSessionStore {
  const sessions = new Map<string, AgentSession>();
  const transcripts = new Map<string, TranscriptEntry[]>();

  return {
    list: () => [...sessions.values()],
    get: (id) => sessions.get(id),
    create: (session) => void sessions.set(session.id, session),
    update: (session) => void sessions.set(session.id, session),
    delete: (id) => void sessions.delete(id),
    entries: (id) => structuredClone(transcripts.get(id) ?? []),
    append(id, entry) {
      transcripts.set(id, [
        ...(transcripts.get(id) ?? []),
        structuredClone(entry),
      ]);
    },
  };
}

function setup(options?: Parameters<typeof fauxProvider>[0]) {
  const faux = fauxProvider(options);
  const models = createModels();

  models.setProvider(faux.provider);

  const store = memoryStore();
  const events: AgentWireEvent[] = [];
  const watchlist = vi.fn(() => "TW 2330");

  store.create({ id: "s1", title: "", createdAt: 0, updatedAt: 0 });

  const runtime = createAgentRuntime({
    store,
    streamFn: (model, context, options) =>
      models.streamSimple(model, context, options),
    model: async () => ({
      model: faux.getModel(),
      apiKey: "test-key",
      thinking: AgentThinking.Off,
    }),
    tools: () => [
      {
        name: "get_watchlist",
        label: "Watchlist",
        description: "The watchlist",
        parameters: { type: "object", properties: {} },
        execute: async () => ({
          content: [{ type: "text", text: watchlist() }],
          details: { count: 1 },
        }),
      },
    ],
    onEvent: (_sessionId, event) => events.push(event),
  });

  const settled = () =>
    vi.waitFor(() => expect(runtime.isRunning("s1")).toBe(false));

  return { faux, store, events, runtime, watchlist, settled };
}

test("a run stores every message and streams the same conversation it replays", async () => {
  const { faux, store, events, runtime, watchlist, settled } = setup();

  faux.setResponses([
    fauxAssistantMessage(fauxToolCall("get_watchlist", {}), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("You watch 2330."),
  ]);

  await runtime.send("s1", { text: "What do I watch?", context: "time: now" });
  await settled();

  expect(watchlist).toHaveBeenCalledOnce();
  expect(store.entries("s1").map((entry) => entry.message.role)).toEqual([
    "user",
    "assistant",
    "toolResult",
    "assistant",
  ]);
  expect(store.get("s1")?.title).toBe("What do I watch?");

  const live = foldEvents(events);
  const replayed = foldEvents(runtime.transcript("s1"));

  expect(live.running).toBe(false);
  expect(live.items).toMatchObject([
    { kind: "user", text: "What do I watch?" },
    { kind: "assistant", text: "" },
    { kind: "tool", toolName: "get_watchlist", status: ToolCallStatus.Ok },
    { kind: "assistant", text: "You watch 2330." },
  ]);
  expect(replayed.items).toEqual(live.items);
  expect(events.at(-1)).toEqual({
    type: AgentEventType.RunEnd,
    reason: RunEndReason.Done,
  });
});

test("the app's context reaches the model but not the thread", async () => {
  const { faux, runtime, settled } = setup();
  let seen = "";

  faux.setResponses([
    (context) => {
      seen = JSON.stringify(context.messages);

      return fauxAssistantMessage("ok");
    },
  ]);

  await runtime.send("s1", { text: "hi", context: "viewing: TW 2330" });
  await settled();

  expect(seen).toContain("viewing: TW 2330");
  expect(foldEvents(runtime.transcript("s1")).items[0]).toMatchObject({
    kind: "user",
    text: "hi",
  });
});

test("a provider error ends the run with its message", async () => {
  const { faux, events, runtime, settled } = setup();

  faux.setResponses([
    fauxAssistantMessage("", {
      stopReason: "error",
      errorMessage: "invalid x-api-key",
    }),
  ]);

  await runtime.send("s1", { text: "hi", context: "" });
  await settled();

  expect(events.at(-1)).toEqual({
    type: AgentEventType.RunEnd,
    reason: RunEndReason.Error,
    error: "invalid x-api-key",
  });
  expect(foldEvents(runtime.transcript("s1")).items.at(-1)).toEqual({
    kind: "notice",
    reason: RunEndReason.Error,
    error: "invalid x-api-key",
  });
});

test("one run per conversation at a time", async () => {
  const { faux, runtime, settled } = setup();

  faux.setResponses([
    async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));

      return fauxAssistantMessage("slow");
    },
  ]);

  await runtime.send("s1", { text: "first", context: "" });

  await expect(
    runtime.send("s1", { text: "second", context: "" })
  ).rejects.toThrow("still answering");
  await settled();
});

test("stopping a run keeps what streamed and ends it as aborted", async () => {
  const { faux, events, runtime } = setup({ tokensPerSecond: 20 });

  faux.setResponses([fauxAssistantMessage("a long answer ".repeat(40))]);

  await runtime.send("s1", { text: "hi", context: "" });
  await vi.waitFor(() =>
    expect(
      events.some((event) => event.type === AgentEventType.AssistantDelta)
    ).toBe(true)
  );
  await runtime.stop("s1");

  expect(runtime.isRunning("s1")).toBe(false);
  expect(events.at(-1)).toEqual({
    type: AgentEventType.RunEnd,
    reason: RunEndReason.Aborted,
  });
  expect(foldEvents(runtime.transcript("s1")).items).toMatchObject([
    { kind: "user" },
    { kind: "assistant", text: expect.stringContaining("a long") },
    { kind: "notice", reason: RunEndReason.Aborted },
  ]);
});

test("a model that is not set up rejects before anything is stored", async () => {
  const store = memoryStore();

  store.create({ id: "s1", title: "", createdAt: 0, updatedAt: 0 });

  const runtime = createAgentRuntime({
    store,
    streamFn: vi.fn(),
    model: async () => {
      throw new Error("Save an API key first");
    },
    tools: () => [],
    onEvent: vi.fn(),
  });

  await expect(runtime.send("s1", { text: "hi", context: "" })).rejects.toThrow(
    "Save an API key first"
  );
  expect(store.entries("s1")).toEqual([]);
  expect(runtime.isRunning("s1")).toBe(false);
});
