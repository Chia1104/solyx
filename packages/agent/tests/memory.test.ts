import type { Context, JsonValue } from "@earendil-works/chord";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import {
  contentText,
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import type { ToolCall } from "@earendil-works/pi-ai";
import { MemoryStorage } from "@earendil-works/pi-durable";
import type {
  PromptInput,
  ToolExecutionApi,
  ToolRegistration,
} from "@earendil-works/pi-durable";
import { expect, test, vi } from "vite-plus/test";

import { Market } from "@solyx/core/market";
import { MemoryKind } from "@solyx/core/memory";
import type { Memory, MemoryDraft, MemoryStore } from "@solyx/core/memory";

import { createMemory } from "../src/memory.ts";
import { AgentThinking } from "../src/providers.ts";
import { createAgentRuntime } from "../src/runtime.ts";
import {
  AgentEventType,
  AgentItemKind,
  AgentToolName,
  ApprovalMode,
  ToolCallStatus,
  foldEvents,
} from "../src/wire.ts";
import type { AgentWireEvent, ToolCallView } from "../src/wire.ts";

type ToolArguments = Parameters<ToolRegistration["execute"]>[0];

// 2026-09-30 10:00 in Taipei.
const NOW = new Date("2026-09-30T02:00:00Z");

const TSMC = { market: Market.TW, symbol: "2330" };

/** Memories in a map, found by any word of a query; the SQLite store is tested in @solyx/db. */
function fakeStore(): MemoryStore {
  const memories = new Map<string, Memory>();

  const list = () =>
    [...memories.values()].toSorted((a, b) => b.updatedAt - a.updatedAt);

  return {
    list,
    read: (ids) => ids.flatMap((id) => memories.get(id) ?? []),
    search: (query, limit) =>
      list()
        .filter((memory) =>
          query
            .split(/\s+/)
            .some((word) =>
              `${memory.listing?.symbol} ${memory.description} ${memory.body}`.includes(
                word
              )
            )
        )
        .slice(0, limit),
    save(draft: MemoryDraft, at: number) {
      const saved = {
        ...draft,
        createdAt: memories.get(draft.id)?.createdAt ?? at,
        updatedAt: at,
      };

      memories.set(draft.id, saved);

      return saved;
    },
    forget: (id) => memories.delete(id),
  };
}

function note(id: string, patch: Partial<MemoryDraft> = {}): MemoryDraft {
  return {
    id,
    kind: MemoryKind.Note,
    listing: null,
    description: `Note ${id}`,
    body: "",
    source: null,
    ...patch,
  };
}

/** The agent with memory alone, answering as `faux` scripts it. */
function setup() {
  const store = fakeStore();
  const memory = createMemory({ store, now: () => NOW });
  const faux = fauxProvider();
  const models = createModels();
  const events: AgentWireEvent[] = [];
  /** What each request carried, as JSON. */
  const requests: string[] = [];

  models.setProvider(faux.provider);

  const runtime = createAgentRuntime({
    store: Promise.resolve({
      storage: new MemoryStorage(),
      deleteConversation: vi.fn(async () => undefined),
    }),
    models,
    model: async () => ({
      model: faux.getModel(),
      thinking: AgentThinking.Off,
    }),
    tools: async (guard) => ({
      offered: [memory.extension(guard)],
      deferred: [],
    }),
    onEvent: (_sessionId, event) => events.push(event),
  });

  const calls = () =>
    foldEvents(events).items.filter(
      (item): item is ToolCallView => item.kind === AgentItemKind.Tool
    );

  const ended = (runs = 1) =>
    vi.waitFor(() =>
      expect(
        events.filter((event) => event.type === AgentEventType.RunEnd)
      ).toHaveLength(runs)
    );

  /** Starts a run whose replies call each tool in turn, in a conversation set to `mode`. */
  async function start(
    mode: ApprovalMode,
    ...toolCalls: [AgentToolName, ToolCall["arguments"]][]
  ) {
    const { id } = await runtime.create();

    await runtime.setApprovalMode(id, mode);
    faux.setResponses([
      ...toolCalls.map(([name, args]) =>
        fauxAssistantMessage(fauxToolCall(name, args), {
          stopReason: "toolUse",
        })
      ),
      (context) => {
        requests.push(JSON.stringify(context.messages));

        return fauxAssistantMessage("Done.");
      },
    ]);

    await runtime.send(id, { text: "Remember this", context: "" });

    return id;
  }

  return { store, memory, runtime, events, requests, calls, ended, start };
}

/** A call's api as pi-durable hands it to a tool, keeping the call's memo between runs. */
function callApi(callId: string): ToolExecutionApi {
  const memos = new Map<string, JsonValue>();

  // SAFETY: the memory tools read only the call's ids and its memo.
  return {
    conversationId: 7,
    callId,
    async memo(name: string, candidate: JsonValue, _context: Context) {
      if (!memos.has(name)) memos.set(name, candidate);

      return memos.get(name);
    },
  } as ToolExecutionApi;
}

/** The extension's tools with nothing to ask, called as pi-durable would call them. */
function direct(store: MemoryStore) {
  const extension = createMemory({ store, now: () => NOW }).extension(
    (tool) => tool
  );

  async function run(
    name: AgentToolName,
    params: ToolArguments,
    api = callApi("call-1")
  ) {
    const tool = extension.tools?.find(
      (candidate: ToolRegistration) => candidate.name === name
    );

    if (!tool) throw new Error(`No tool ${name}`);

    const result = await tool.execute(params, api, BACKGROUND_CONTEXT);

    return contentText(result.content ?? []);
  }

  async function index() {
    const [section] = extension.sections ?? [];

    // SAFETY: the memory list reads only the store.
    return section?.render({} as PromptInput, BACKGROUND_CONTEXT);
  }

  return { run, index };
}

test("remember waits for the user, and what they allow joins the list the next request carries", async () => {
  const { store, runtime, requests, calls, ended, start } = setup();

  const id = await start(ApprovalMode.Ask, [
    AgentToolName.Remember,
    {
      kind: MemoryKind.Note,
      listing: TSMC,
      description: "使用者看好台積電第四季毛利",
      body: "Thesis from the September call.",
    },
  ]);

  await vi.waitFor(() =>
    expect(calls()[0]).toMatchObject({
      status: ToolCallStatus.AwaitingApproval,
    })
  );
  expect(store.list()).toEqual([]);

  runtime.approve(id, calls()[0].toolCallId, true);
  await ended();

  expect(store.list()).toMatchObject([
    {
      kind: MemoryKind.Note,
      listing: TSMC,
      description: "使用者看好台積電第四季毛利",
      body: "Thesis from the September call.",
      createdAt: NOW.getTime(),
      source: id,
    },
  ]);
  expect(requests[0]).toContain("使用者看好台積電第四季毛利");
  expect(requests[0]).toContain(
    'listing=\\"TW 2330\\" written=\\"2026-09-30\\"'
  );

  await runtime.close();
});

test("a memory the user does not allow is not saved, and bypass saves without asking", async () => {
  const denied = setup();

  const id = await denied.start(ApprovalMode.Ask, [
    AgentToolName.Remember,
    { kind: MemoryKind.Feedback, description: "Reply in English" },
  ]);

  await vi.waitFor(() =>
    expect(denied.calls()[0]).toMatchObject({
      status: ToolCallStatus.AwaitingApproval,
    })
  );
  denied.runtime.approve(id, denied.calls()[0].toolCallId, false);
  await denied.ended();

  expect(denied.calls()[0]).toMatchObject({ status: ToolCallStatus.Error });
  expect(denied.store.list()).toEqual([]);
  await denied.runtime.close();

  const bypass = setup();

  await bypass.start(ApprovalMode.Bypass, [
    AgentToolName.Remember,
    { kind: MemoryKind.Feedback, description: "Reply in English" },
  ]);
  await bypass.ended();

  expect(bypass.store.list()).toHaveLength(1);
  await bypass.runtime.close();
});

test("a call that cannot run fails before the user is asked", async () => {
  const { store, events, calls, ended, start, runtime } = setup();

  await start(
    ApprovalMode.Ask,
    [
      AgentToolName.Remember,
      { id: "nope", kind: MemoryKind.Note, description: "Rewrite" },
    ],
    [
      AgentToolName.Remember,
      {
        kind: MemoryKind.Note,
        description: "Key sk-ant-api03-abcdefghijklmnopqrstuvwxyz",
      },
    ],
    [AgentToolName.Forget, { id: "nope" }]
  );
  await ended();

  expect(calls().map((call) => call.status)).toEqual([
    ToolCallStatus.Error,
    ToolCallStatus.Error,
    ToolCallStatus.Error,
  ]);
  expect(calls()[0].error).toContain("No memory has the id nope");
  expect(
    events.some((event) => event.type === AgentEventType.ApprovalRequest)
  ).toBe(false);
  expect(store.list()).toEqual([]);

  await runtime.close();
});

test("recall reads memories by id and by search, and says which are gone", async () => {
  const store = fakeStore();

  store.save(note("a1", { body: "Stop below 950", listing: TSMC }), 1);
  store.save(note("b2", { description: "Prefers short replies" }), 2);

  const { run } = direct(store);

  const text = await run(AgentToolName.Recall, {
    ids: ["a1", "gone"],
    query: "short",
  });

  expect(text).toBe(
    [
      '<memory id="a1" kind="note" listing="TW 2330" written="1970-01-01">\nNote a1\n\nStop below 950\n</memory>',
      '<memory id="b2" kind="note" written="1970-01-01">\nPrefers short replies\n</memory>',
      "No memory has the id gone; it may be forgotten.",
    ].join("\n\n")
  );
  await expect(run(AgentToolName.Recall, {})).rejects.toThrow("Give ids");
});

test("a remember call that runs again rewrites the memory it saved", async () => {
  const store = fakeStore();
  const { run } = direct(store);

  const args = { kind: MemoryKind.Profile, description: "Risk 0.5% a trade" };

  // The same call, as pi-durable runs it again after a restart, keeps its memo.
  const call = callApi("call-1");

  await run(AgentToolName.Remember, args, call);
  await run(AgentToolName.Remember, args, call);

  expect(store.list()).toHaveLength(1);

  await run(AgentToolName.Remember, args, callApi("call-2"));

  expect(store.list()).toHaveLength(2);
});

test("the list leads with profile and feedback, then the newest notes, and counts what it leaves out", async () => {
  const store = fakeStore();

  store.save(
    { ...note("f1"), kind: MemoryKind.Feedback, description: "Brief replies" },
    0
  );

  for (let index = 1; index <= 100; index += 1) {
    store.save(note(`n${index}`, { description: "x".repeat(140) }), index);
  }

  const { index } = direct(store);
  const text = (await index()) ?? "";

  expect(text.indexOf('id="f1"')).toBeLessThan(text.indexOf('id="n100"'));
  expect(text).not.toContain('id="n1"');
  expect(text).toMatch(/\n\d+ more not listed; find them with recall\.$/);
  expect(text.length).toBeLessThan(10_000);

  expect(await direct(fakeStore()).index()).toContain("No memories yet.");
});
