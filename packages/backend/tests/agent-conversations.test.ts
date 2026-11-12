import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { defineExtension } from "@earendil-works/pi-durable";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";

import { AgentThinking } from "@solyx/agent/providers";
import { createAgentRuntime } from "@solyx/agent/runtime";
import { AgentEventType } from "@solyx/agent/wire";
import type { AgentWireEvent } from "@solyx/agent/wire";
import { openAgentStore } from "@solyx/db/agent";

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "solyx-conversations-"));
});

afterEach(() => rm(directory, { recursive: true, force: true }));

const WATCHLIST = defineExtension({
  name: "test",
  tools: [
    {
      name: "get_watchlist",
      description: "The watchlist",
      parameters: { type: "object", properties: {} },
      replay: "safe",
      execute: async () => ({ output: [{ type: "text", text: "TW 2330" }] }),
    },
  ],
});

/** The runtime over the store the app opens, on a model that answers as the test says. */
function setup() {
  const faux = fauxProvider();
  const models = createModels();

  models.setProvider(faux.provider);

  const events: AgentWireEvent[] = [];
  const storeFailed = vi.fn();
  const reported = vi.fn();

  const open = () =>
    createAgentRuntime({
      store: openAgentStore(join(directory, "agent.sqlite")),
      models,
      model: async () => ({
        model: faux.getModel(),
        thinking: AgentThinking.Off,
      }),
      tools: async () => ({ offered: [WATCHLIST], deferred: [] }),
      onEvent: (_sessionId, event) => events.push(event),
      onStoreFailure: storeFailed,
      onReport: reported,
    });

  /** Resolves once `count` runs have ended. */
  const ended = (count: number) =>
    vi.waitFor(() =>
      expect(
        events.filter((event) => event.type === AgentEventType.RunEnd)
      ).toHaveLength(count)
    );

  return { faux, open, ended, storeFailed, reported };
}

test("a conversation deleted while it answers is gone, and the others carry on", async () => {
  const { faux, open, ended, storeFailed, reported } = setup();
  const runtime = open();

  const gone = await runtime.create();
  const kept = await runtime.create();

  faux.setResponses([
    fauxAssistantMessage([fauxToolCall("get_watchlist", {})]),
    fauxAssistantMessage("You watch 2330."),
    fauxAssistantMessage("Hello."),
    fauxAssistantMessage("a long answer ".repeat(400)),
    fauxAssistantMessage("Hello again."),
  ]);

  await runtime.send(gone.id, { text: "What do I watch?", context: "" });
  await ended(1);
  await runtime.send(kept.id, { text: "Hi", context: "" });
  await ended(2);

  await runtime.send(gone.id, { text: "Tell me more", context: "" });
  await runtime.delete(gone.id);
  await ended(3);

  // pi-durable still holds what it read of the conversation, and reading the rest of it from the
  // file would fail the store for every conversation.
  await expect(runtime.transcript(gone.id)).rejects.toThrow("not found");
  await expect(
    runtime.send(gone.id, { text: "Still there?", context: "" })
  ).rejects.toThrow("not found");
  expect(await runtime.busy(gone.id)).toBe(false);
  expect((await runtime.sessions()).map(({ id }) => id)).toEqual([kept.id]);

  await runtime.send(kept.id, { text: "Hi again", context: "" });
  await ended(4);

  expect(storeFailed).not.toHaveBeenCalled();
  expect(reported).not.toHaveBeenCalled();

  await runtime.close();

  const reopened = open();

  expect((await reopened.sessions()).map(({ id }) => id)).toEqual([kept.id]);
  await expect(reopened.transcript(gone.id)).rejects.toThrow("not found");

  await reopened.close();
});
