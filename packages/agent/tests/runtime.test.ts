import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import type {
  AssistantMessage,
  FauxResponseFactory,
} from "@earendil-works/pi-ai";
import { getCurrentTools } from "@earendil-works/pi-ai/utils/transcript";
import { MemoryStorage, defineExtension } from "@earendil-works/pi-durable";
import type {
  Extension,
  HarnessSettings,
  ToolRegistration,
} from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";

import { AgentThinking } from "../src/providers.ts";
import { createAgentRuntime } from "../src/runtime.ts";
import type { AgentConversationStore } from "../src/runtime.ts";
import {
  AgentEventType,
  AgentItemKind,
  ApprovalMode,
  CompactionOutcome,
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

const NO_TOOLS = defineExtension({ name: "app" });

/** A host whose only tools are one extension's, offered in every request. */
const only = (extension: Extension) => async () => ({
  offered: [extension],
  deferred: [],
});

function memoryStore(): AgentConversationStore {
  return {
    storage: new MemoryStorage(),
    deleteConversation: vi.fn(async () => undefined),
  };
}

function setup({
  store = memoryStore(),
  faux = fauxProvider(),
  settings,
}: {
  store?: AgentConversationStore;
  faux?: ReturnType<typeof fauxProvider>;
  settings?: HarnessSettings;
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
    tools: only(
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
      })
    ),
    onEvent: (_sessionId, event) => events.push(event),
    settings,
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

test("an MCP tool is offered once a search loads it, and stays loaded", async () => {
  const faux = fauxProvider();
  const models = createModels();
  const events: AgentWireEvent[] = [];
  const quote = vi.fn(() => "2330 at 1000");

  models.setProvider(faux.provider);

  const tool = (
    name: string,
    run: () => ReturnType<ToolRegistration["execute"]>
  ): ToolRegistration => ({
    name,
    description: name,
    parameters: { type: "object", properties: {} },
    replay: "safe",
    execute: run,
  });

  const runtime = createAgentRuntime({
    store: Promise.resolve(memoryStore()),
    models,
    model: async () => ({
      model: faux.getModel(),
      thinking: AgentThinking.Off,
    }),
    tools: async () => ({
      offered: [
        NO_TOOLS,
        defineExtension({
          name: "search",
          tools: [
            tool("search_tools", async () => ({
              content: [{ type: "text", text: "Loaded quote" }],
              control: { addTools: ["quote"] },
            })),
          ],
        }),
      ],
      deferred: [
        defineExtension({
          name: "quotes",
          tools: [
            tool("quote", async () => ({
              content: [{ type: "text", text: quote() }],
            })),
          ],
        }),
      ],
    }),
    onEvent: (_sessionId, event) => events.push(event),
  });

  const offered: string[][] = [];

  // Answers with `message`, noting which tools the request offered.
  const answer =
    (message: AssistantMessage): FauxResponseFactory =>
    (context) => {
      offered.push(getCurrentTools(context.messages).map((each) => each.name));

      return message;
    };

  faux.setResponses([
    answer(
      fauxAssistantMessage(fauxToolCall("search_tools", {}), {
        stopReason: "toolUse",
      })
    ),
    answer(
      fauxAssistantMessage(fauxToolCall("quote", {}), { stopReason: "toolUse" })
    ),
    answer(fauxAssistantMessage("2330 is at 1000.")),
    answer(fauxAssistantMessage("Still 1000.")),
  ]);

  const ended = (count: number) =>
    vi.waitFor(() =>
      expect(
        events.filter((event) => event.type === AgentEventType.RunEnd)
      ).toHaveLength(count)
    );

  const { id } = await runtime.create();

  await runtime.send(id, { text: "Quote 2330", context: "" });
  await ended(1);
  await runtime.send(id, { text: "And now?", context: "" });
  await ended(2);

  expect(quote).toHaveBeenCalledOnce();
  expect(offered).toEqual([
    ["search_tools"],
    ["search_tools", "quote"],
    ["search_tools", "quote"],
    ["search_tools", "quote"],
  ]);

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
    tools: only(NO_TOOLS),
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
      tools: only(NO_TOOLS),
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

/** A run that loads an MCP tool the user must allow, as `search_tools` would, and calls it. */
function approvalSetup(store = memoryStore()) {
  const faux = fauxProvider();
  const models = createModels();
  const events: AgentWireEvent[] = [];
  const placed = vi.fn(() => "Placed");

  models.setProvider(faux.provider);

  const runtime = createAgentRuntime({
    store: Promise.resolve(store),
    models,
    model: async () => ({
      model: faux.getModel(),
      thinking: AgentThinking.Off,
    }),
    tools: async (guard) => ({
      offered: [
        NO_TOOLS,
        defineExtension({
          name: "search",
          tools: [
            {
              name: "search_tools",
              description: "Finds tools",
              parameters: { type: "object", properties: {} },
              replay: "safe",
              execute: async () => ({
                content: [{ type: "text", text: "Loaded place_order" }],
                control: { addTools: ["place_order"] },
              }),
            },
          ],
        }),
      ],
      deferred: [
        defineExtension({
          name: "broker",
          tools: [
            guard({
              name: "place_order",
              description: "Places an order",
              parameters: { type: "object", properties: {} },
              replay: "unsafe",
              execute: async () => ({
                content: [{ type: "text", text: placed() }],
              }),
            }),
          ],
        }),
      ],
    }),
    onEvent: (_sessionId, event) => events.push(event),
  });

  faux.setResponses([
    fauxAssistantMessage(fauxToolCall("search_tools", {}), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage(fauxToolCall("place_order", {}), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("Done."),
  ]);

  const order = () =>
    foldEvents(events).items.find(
      (item) =>
        item.kind === AgentItemKind.Tool && item.toolName === "place_order"
    );

  /** Starts the run and resolves the call's id once it waits for the user. */
  async function ask(mode: ApprovalMode = ApprovalMode.Ask) {
    const { id } = await runtime.create();

    await runtime.setApprovalMode(id, mode);

    await runtime.send(id, { text: "Buy 2330", context: "" });
    await vi.waitFor(() =>
      expect(order()).toMatchObject({
        status: ToolCallStatus.AwaitingApproval,
      })
    );

    const call = order();

    if (call?.kind !== AgentItemKind.Tool) throw new Error("No call");

    return { id, toolCallId: call.toolCallId };
  }

  const ended = () =>
    vi.waitFor(() =>
      expect(events.at(-1)).toMatchObject({ type: AgentEventType.RunEnd })
    );

  return { runtime, events, placed, order, ask, ended };
}

test("a call the user must allow waits in its conversation, which a reload shows, until they do", async () => {
  const { runtime, events, placed, order, ask, ended } = approvalSetup();
  const { id, toolCallId } = await ask();

  // The question follows its call's start, so every fold finds the call it asks about.
  expect(
    events.findIndex(
      (event) =>
        event.type === AgentEventType.ApprovalRequest &&
        event.toolCallId === toolCallId
    )
  ).toBeGreaterThan(
    events.findIndex(
      (event) =>
        event.type === AgentEventType.ToolStart &&
        event.toolCallId === toolCallId
    )
  );
  expect(foldEvents(await runtime.transcript(id)).items).toEqual(
    foldEvents(events).items
  );
  expect(placed).not.toHaveBeenCalled();

  runtime.approve(id, toolCallId, true);
  await ended();

  expect(placed).toHaveBeenCalledOnce();
  expect(order()).toMatchObject({ status: ToolCallStatus.Ok });
  expect(() => runtime.approve(id, toolCallId, true)).toThrow(
    "no longer waiting"
  );

  await runtime.close();
});

test("another conversation cannot answer a call, and stopping the run withdraws its question as refused", async () => {
  const { runtime, placed, ask, ended } = approvalSetup();
  const { id, toolCallId } = await ask();
  const other = await runtime.create();

  expect(() => runtime.approve(other.id, toolCallId, true)).toThrow(
    "no longer waiting"
  );

  await runtime.abort(id);
  await ended();

  expect(placed).not.toHaveBeenCalled();
  expect(() => runtime.approve(id, toolCallId, true)).toThrow(
    "no longer waiting"
  );

  await runtime.close();
});

test("a transcript read from storage still shows what the user answered", async () => {
  const path = join(directory, "agent.sqlite");

  const fileStore = async (): Promise<AgentConversationStore> => ({
    storage: await openNodeSqliteStorage(path),
    deleteConversation: vi.fn(async () => undefined),
  });

  const first = approvalSetup(await fileStore());
  const { id, toolCallId } = await first.ask();

  first.runtime.approve(id, toolCallId, true);
  await first.ended();
  await first.runtime.close();

  const second = approvalSetup(await fileStore());
  const replayed = await second.runtime.transcript(id);

  expect(
    replayed.filter(
      (event) => "toolCallId" in event && event.toolCallId === toolCallId
    )
  ).toMatchObject([
    { type: AgentEventType.ToolStart },
    { type: AgentEventType.ApprovalRequest },
    { type: AgentEventType.ApprovalResolved, approved: true },
    { type: AgentEventType.ToolEnd, status: ToolCallStatus.Ok },
  ]);

  await second.runtime.close();
});

test("a conversation the user set to bypass runs its guarded calls without asking", async () => {
  const { runtime, events, placed, ended } = approvalSetup();
  const { id } = await runtime.create();

  expect(await runtime.sessions()).toMatchObject([
    { id, approvalMode: ApprovalMode.Ask },
  ]);

  await runtime.setApprovalMode(id, ApprovalMode.Bypass);
  await runtime.send(id, { text: "Buy 2330", context: "" });
  await ended();

  expect(placed).toHaveBeenCalledOnce();
  expect(
    events.some((event) => event.type === AgentEventType.ApprovalRequest)
  ).toBe(false);
  expect(await runtime.sessions()).toMatchObject([
    { id, approvalMode: ApprovalMode.Bypass },
  ]);

  await runtime.close();
});

test("in a conversation set to auto, a tool nothing can judge still asks", async () => {
  const { runtime, placed, ask, ended } = approvalSetup();
  const { id, toolCallId } = await ask(ApprovalMode.Auto);

  expect(placed).not.toHaveBeenCalled();

  runtime.approve(id, toolCallId, true);
  await ended();

  expect(placed).toHaveBeenCalledOnce();

  await runtime.close();
});

test("a conversation starts on the model and approval mode picked before its first message", async () => {
  const { runtime } = setup();

  const picked = {
    model: { provider: "openai", id: "gpt-6.1-sol" },
    thinking: AgentThinking.High,
    approvalMode: ApprovalMode.Bypass,
  };

  const created = await runtime.create(picked);

  expect(created).toMatchObject(picked);
  expect(await runtime.sessions()).toMatchObject([
    { id: created.id, ...picked },
  ]);

  await runtime.close();
});

test("a conversation's own model and thinking reach the run, and one without them follows the default", async () => {
  const faux = fauxProvider();
  const models = createModels();
  const events: AgentWireEvent[] = [];

  const model = vi.fn(async () => ({
    model: faux.getModel(),
    thinking: AgentThinking.Off,
  }));

  models.setProvider(faux.provider);

  const runtime = createAgentRuntime({
    store: Promise.resolve(memoryStore()),
    models,
    model,
    tools: only(NO_TOOLS),
    onEvent: (_sessionId, event) => events.push(event),
  });

  const ended = (count: number) =>
    vi.waitFor(() =>
      expect(
        events.filter((event) => event.type === AgentEventType.RunEnd)
      ).toHaveLength(count)
    );

  const { id } = await runtime.create();

  faux.setResponses([
    fauxAssistantMessage("One."),
    fauxAssistantMessage("Two."),
  ]);

  await runtime.send(id, { text: "First", context: "" });
  await ended(1);

  expect(model).toHaveBeenLastCalledWith({ model: null, thinking: null });

  const pick = {
    model: { provider: "openai", id: "gpt-6.1-sol" },
    thinking: AgentThinking.High,
  };

  await runtime.setModel(id, pick);
  await runtime.send(id, { text: "Second", context: "" });
  await ended(2);

  expect(model).toHaveBeenLastCalledWith(pick);
  expect(await runtime.sessions()).toMatchObject([{ id, ...pick }]);

  await runtime.close();
});

test("compacting by hand places a summary the thread shows, and the context shrinks", async () => {
  const { faux, events, runtime, ended } = setup({
    settings: { compaction: { keepRecentTokens: 1 } },
  });

  const { id } = await runtime.create();
  const long = "word ".repeat(1500);

  faux.setResponses([
    fauxAssistantMessage(`one ${long}`),
    fauxAssistantMessage(`two ${long}`),
    fauxAssistantMessage("## Goal\nWatch 2330"),
  ]);
  await runtime.send(id, { text: "first", context: "" });
  await ended(1);
  await runtime.send(id, { text: "second", context: "" });
  await ended(2);

  const before = foldEvents(events).context ?? 0;

  expect(await runtime.compact(id, "Keep the watchlist")).toBe(
    CompactionOutcome.Summarized
  );
  await vi.waitFor(() =>
    expect(foldEvents(events).items.at(-1)).toMatchObject({
      kind: AgentItemKind.Compaction,
      summary: "## Goal\nWatch 2330",
    })
  );

  const after = foldEvents(events);

  expect(after.compactions).toEqual([]);
  expect(after.context).toBeLessThan(before);
  expect(foldEvents(await runtime.transcript(id))).toEqual(after);
});

test("a conversation whose messages are all recent has nothing to compact", async () => {
  const { faux, runtime, ended } = setup();
  const { id } = await runtime.create();

  faux.setResponses([fauxAssistantMessage("hello")]);
  await runtime.send(id, { text: "hi", context: "" });
  await ended();

  expect(await runtime.compact(id)).toBe(CompactionOutcome.NothingOld);
});
