import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import {
  createSession,
  defineDoc,
  defineTask,
} from "@earendil-works/pi-durable";
import type { ConversationId, Session } from "@earendil-works/pi-durable";
import { afterEach, beforeEach, expect, test } from "vite-plus/test";

import { openAgentStore } from "../src/agent.ts";
import type { AgentStore } from "../src/agent.ts";

const context = BACKGROUND_CONTEXT;

const NoteDoc = defineDoc<{ text: string }>({
  kind: "test.note",
  version: 1,
  scope: "conversation",
  history: "latest",
  fork: "initial",
  initial: () => ({ text: "" }),
});

// Never runs here, so a task made from it stays pending.
const Chore = defineTask<null, { phase: "only" }, null>({
  name: "test.chore",
  version: 1,
  initial: () => ({ phase: "only" }),
  phases: { only: async () => undefined },
  abort: async () => undefined,
});

let directory: string;

let path: string;

let store: AgentStore;

let session: Session;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "solyx-agent-store-"));
  path = join(directory, "agent.sqlite");
  store = await openAgentStore(path);
  session = createSession(store.storage);
});

afterEach(async () => {
  await session.close(context).catch(() => undefined);
  await rm(directory, { recursive: true, force: true });
});

/** A conversation holding `words` in an entry and in a document. */
function conversation(words: string): Promise<ConversationId> {
  return session.commit(async (tx) => {
    const { id } = await tx.createConversation({
      ownership: { kind: "ownerless" },
    });

    await tx.appendEntry(id, { kind: "test.entry", data: `${words} entry` });
    (await tx.doc(NoteDoc, id)).text = `${words} note`;

    return id;
  }, context);
}

test("a deleted conversation leaves nothing of its own in the file", async () => {
  const kept = await conversation("kept");
  const gone = await conversation("secret");

  await store.deleteConversation(gone);

  expect(
    await session.commit((tx) => tx.conversation(gone), context)
  ).toBeUndefined();
  expect(await session.snapshot(NoteDoc, kept, context)).toEqual({
    text: "kept note",
  });

  await session.close(context);

  const bytes = await readFile(path);

  expect(bytes.includes("kept entry")).toBe(true);
  expect(bytes.includes("secret entry")).toBe(false);
  expect(bytes.includes("secret note")).toBe(false);

  // A fresh conversation never takes an erased one's id.
  store = await openAgentStore(path);
  session = createSession(store.storage);

  expect(await conversation("later")).toBeGreaterThan(gone);
});

test("a conversation with work still pending is kept", async () => {
  const id = await conversation("busy");

  await session.commit(
    (tx) =>
      tx.createTask(Chore, null, {
        ownership: { kind: "conversation" },
        conversationId: id,
      }),
    context
  );

  await expect(store.deleteConversation(id)).rejects.toThrow(
    "still has work running"
  );
  expect(await session.snapshot(NoteDoc, id, context)).toEqual({
    text: "busy note",
  });
});

test("a conversation another forks from is kept", async () => {
  const parent = await conversation("parent");

  await session.commit(async (tx) => {
    const [entry] = (await tx.scanEntries({ conversationId: parent }, 1)).items;

    if (entry) {
      await tx.forkConversation(parent, entry.id, {
        ownership: { kind: "ownerless" },
      });
    }
  }, context);

  await expect(store.deleteConversation(parent)).rejects.toThrow("forks");
});
