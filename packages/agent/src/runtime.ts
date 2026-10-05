import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { clampThinkingLevel } from "@earendil-works/pi-ai";
import type {
  Api,
  AssistantMessage,
  Model,
  Models,
} from "@earendil-works/pi-ai";
import {
  AssistantEntry,
  ConversationBusy,
  Harness,
  LiveDoc,
  UserEntry,
  configure,
  createRegistry,
  defineDoc,
  watchEvents,
} from "@earendil-works/pi-durable";
import type {
  AgentEvent,
  AgentEventStream,
  Conversation,
  ConversationId,
  Cursor,
  EntryId,
  HarnessOptions,
  HarnessSettings,
  MessageChange,
  Page,
  Storage,
  SubmissionRecord,
} from "@earendil-works/pi-durable";
import { maxBy, noop } from "es-toolkit";
import * as z from "zod";

import { ApprovalDoc, createApprovalGate } from "./approval.ts";
import type { ToolGuard } from "./approval.ts";
import type { AgentThinking } from "./providers.ts";
import { firstLine } from "./text.ts";
import { createToolsetLoader } from "./toolset.ts";
import type { Toolset } from "./toolset.ts";
import { createTranscriber, replyText, userContent } from "./transcript.ts";
import type { Transcriber } from "./transcript.ts";
import {
  AgentEventType,
  ApprovalMode,
  DeltaChannel,
  RunEndReason,
  ToolCallStatus,
} from "./wire.ts";
import type { AgentSession, AgentWireEvent, RunEndEvent } from "./wire.ts";

/** The model the user configured, which pi-ai authenticates through the host's credentials. */
export interface AgentModelChoice {
  model: Model<Api>;
  thinking: AgentThinking;
}

/** Where conversations persist, as `@solyx/db/agent` opens them. */
export interface AgentConversationStore {
  storage: Storage;
  /** Erases an idle conversation and everything it owns. */
  deleteConversation(id: ConversationId): Promise<void>;
}

export interface AgentRuntimeOptions {
  store: Promise<AgentConversationStore>;
  models: Models;
  /** Rejects with a message the user can act on while the model or its key is not set up. */
  model(): Promise<AgentModelChoice>;
  /**
   * The host's tools, built again before every run and before resuming, so a run sees the tools,
   * servers and policies of the moment it starts. A tool that must ask goes through `guard`, so
   * each of its calls waits until the user answers through `approve`.
   */
  tools(guard: ToolGuard): Promise<Toolset>;
  /** Where a conversation's shell commands run; without it no tool has an environment. */
  env?: HarnessOptions["env"];
  onEvent(sessionId: string, event: AgentWireEvent): void;
  settings?: HarnessSettings;
}

export interface AgentTurn {
  text: string;
  /** The app's context for the model, from `formatContext`. */
  context: string;
}

const SessionDoc = defineDoc<{
  title: string;
  createdAt: number;
  updatedAt: number;
}>({
  kind: "solyx.session",
  version: 1,
  scope: "conversation",
  history: "latest",
  fork: "initial",
  initial: () => ({ title: "", createdAt: 0, updatedAt: 0 }),
});

type Block = AssistantMessage["content"][number];

/** A conversation whose events go out as they happen. */
interface Watch {
  stream: AgentEventStream;
  /** The conversation as the stream found it; `transcript` returns it, then `log`. */
  base: AgentWireEvent[];
  /** Every event sent since, consecutive deltas merged. */
  log: AgentWireEvent[];
  /** Read `base` from storage, and turns what the stream stores since into events. */
  transcriber: Transcriber;
  /** The reply streaming now, and the text and thinking already sent of it. */
  streaming?: { id: string; content: Block[]; text: string; thinking: string };
  /** Why the run's input went unanswered, when it ended without a final reply. */
  failure?: RunEndEvent;
}

const TITLE_LENGTH = 60;

const PAGE = 200;

/** Every item of a paged scan, in the order its pages list them. */
async function readAll<Item>(
  read: (cursor: Cursor | undefined) => Promise<Page<Item, Cursor>>
): Promise<Item[]> {
  const items: Item[] = [];
  let cursor: Cursor | undefined;

  do {
    const page = await read(cursor);

    items.push(...page.items);
    cursor = page.next;
  } while (cursor !== undefined);

  return items;
}

function applyChanges(content: Block[], changes: readonly MessageChange[]) {
  for (const change of changes) {
    switch (change.type) {
      case "text_start":
      case "thinking_start":
      case "toolcall_start":
      case "block":
        content[change.contentIndex] = structuredClone(change.block);
        break;

      case "text_delta": {
        const part = content[change.contentIndex];

        if (part?.type === "text") part.text += change.delta;

        break;
      }

      case "thinking_delta": {
        const part = content[change.contentIndex];

        if (part?.type === "thinking") part.thinking += change.delta;

        break;
      }

      case "message":
        content.splice(
          0,
          content.length,
          ...structuredClone(change.message.content)
        );
        break;

      default:
        break;
    }
  }
}

/** How an input went unanswered, as pi-durable settles it, in the run's terms. */
function failureOf(
  record: Extract<SubmissionRecord, { status: "unanswered" }>
): RunEndEvent {
  if (record.reason === "aborted") {
    return { type: AgentEventType.RunEnd, reason: RunEndReason.Aborted };
  }

  // A model error carries the provider's message; other reasons name themselves.
  const message = z.string().safeParse(record.detail).data;

  return {
    type: AgentEventType.RunEnd,
    reason: RunEndReason.Error,
    error:
      message ??
      (record.reason === "no_model" ? "No model is configured" : record.reason),
  };
}

/**
 * Runs conversations on pi-durable's Harness. Every message, reply in progress and tool call is
 * stored before its event goes out, and a run the app's exit cut off continues from where it
 * stopped once `resume` runs at the next start.
 */
export function createAgentRuntime(options: AgentRuntimeOptions) {
  const { onEvent } = options;

  const registry = createRegistry();
  const watches = new Map<ConversationId, Promise<Watch>>();

  // The watches started so far by session id, for the approvals asked in them.
  const watchesBySession = new Map<string, Watch>();

  const opened = options.store.then(async (store) => ({
    store,
    harness: await Harness.open(
      store.storage,
      {
        models: options.models,
        registry,
        settings: options.settings,
        env: options.env,
      },
      BACKGROUND_CONTEXT
    ),
  }));

  // A store that fails to open fails every call that waits for it instead.
  opened.catch(noop);

  /** Sends an event, keeping it for `transcript`. */
  function publish(watch: Watch, sessionId: string, event: AgentWireEvent) {
    const last = watch.log.at(-1);

    if (
      event.type === AgentEventType.AssistantDelta &&
      last?.type === AgentEventType.AssistantDelta &&
      last.messageId === event.messageId &&
      last.channel === event.channel
    ) {
      watch.log[watch.log.length - 1] = {
        ...last,
        delta: last.delta + event.delta,
      };
    } else {
      watch.log.push(event);
    }

    onEvent(sessionId, event);
  }

  const gate = createApprovalGate((sessionId, event) => {
    const watch = watchesBySession.get(sessionId);

    if (!watch) {
      onEvent(sessionId, event);

      return;
    }

    for (const sent of watch.transcriber.approval(event)) {
      publish(watch, sessionId, sent);
    }
  });

  const toolset = createToolsetLoader(registry, () =>
    options.tools(gate.guard)
  );

  async function conversationOf(sessionId: string): Promise<Conversation> {
    const { harness } = await opened;

    const found = /^[1-9]\d*$/.test(sessionId)
      ? // SAFETY: the brand only marks pi-durable's ids; looking the id up checks it names one.
        await harness.conversation(
          Number(sessionId) as ConversationId,
          BACKGROUND_CONTEXT
        )
      : undefined;

    if (!found) throw new Error(`Conversation ${sessionId} not found`);

    return found;
  }

  /**
   * Oldest first, including what a compaction no longer shows the model; with `through`, only the
   * entries up to that one.
   */
  async function history(conversation: Conversation, through?: EntryId) {
    const entries = await readAll((cursor) =>
      conversation.entries(
        through === undefined ? {} : { maxEntryId: through },
        PAGE,
        cursor,
        BACKGROUND_CONTEXT
      )
    );

    return entries.reverse();
  }

  /** The conversation's approval mode and what its calls that asked were answered. */
  async function approvalsOf(id: ConversationId) {
    const { harness } = await opened;

    return (
      (await harness.snapshot(ApprovalDoc, id, BACKGROUND_CONTEXT)) ??
      ApprovalDoc.definition.initial()
    );
  }

  function handle(
    watch: Watch,
    sessionId: string,
    events: readonly AgentEvent[]
  ) {
    const { transcriber } = watch;
    const emit = (event: AgentWireEvent) => publish(watch, sessionId, event);

    const sendDeltas = () => {
      const { streaming } = watch;

      if (!streaming) return;

      const next = replyText(streaming.content);

      for (const channel of [DeltaChannel.Thinking, DeltaChannel.Text]) {
        const sent = streaming[channel];

        // A rewrite of what was sent cannot go out as a delta; the reply's end replaces it whole.
        if (
          next[channel].length > sent.length &&
          next[channel].startsWith(sent)
        ) {
          emit({
            type: AgentEventType.AssistantDelta,
            messageId: streaming.id,
            channel,
            delta: next[channel].slice(sent.length),
          });
          streaming[channel] = next[channel];
        }
      }
    };

    // A run's end and why its input went unanswered arrive in one commit, the reason last.
    for (const event of events) {
      if (event.type === "submission" && event.record.status === "unanswered") {
        watch.failure = failureOf(event.record);
      } else if (event.type === "task_failed") {
        watch.failure = {
          type: AgentEventType.RunEnd,
          reason: RunEndReason.Error,
          error: event.message,
        };
      }
    }

    for (const event of events) {
      switch (event.type) {
        case "run_start":
          watch.failure = undefined;
          transcriber.runStart().forEach(emit);
          break;

        case "message_start":
          if (event.message.role === "assistant") {
            watch.streaming = {
              id: crypto.randomUUID(),
              content: structuredClone(event.message.content),
              text: "",
              thinking: "",
            };
            emit({
              type: AgentEventType.AssistantStart,
              messageId: watch.streaming.id,
            });
            sendDeltas();
          }

          break;

        case "message_update":
          if (watch.streaming) {
            applyChanges(watch.streaming.content, event.changes);
            sendDeltas();
          }

          break;

        case "message_end":
          if (AssistantEntry.is(event.entry)) {
            transcriber.message(event.entry, watch.streaming?.id).forEach(emit);
            watch.streaming = undefined;
          } else if (UserEntry.is(event.entry)) {
            transcriber.message(event.entry).forEach(emit);
          }

          break;

        case "tool_execution_start":
          transcriber
            .toolStart({
              type: AgentEventType.ToolStart,
              toolCallId: event.toolCallId,
              toolName: event.toolName,
              args: event.args,
            })
            .forEach(emit);
          break;

        case "tool_execution_end":
          (event.entry
            ? transcriber.toolResult(event.entry)
            : transcriber.toolEnd({
                type: AgentEventType.ToolEnd,
                toolCallId: event.toolCallId,
                toolName: event.toolName,
                status: ToolCallStatus.Aborted,
              })
          ).forEach(emit);
          break;

        case "run_end":
          transcriber.runEnd(watch.failure).forEach(emit);
          watch.streaming = undefined;
          watch.failure = undefined;
          break;

        default:
          break;
      }
    }
  }

  /** Starts sending a conversation's events, before any run of it starts. */
  function attach(conversation: Conversation): Promise<Watch> {
    const attached = watches.get(conversation.id);

    if (attached) return attached;

    const sessionId = String(conversation.id);

    const watch = (async (): Promise<Watch> => {
      const { harness } = await opened;

      const stream = await watchEvents(
        harness,
        conversation.id,
        BACKGROUND_CONTEXT
      );

      const { snapshot } = stream;

      // Stored entries never change and ids only grow, so the history up to the newest entry the
      // stream found is the conversation as it found it; later entries arrive as events.
      const newest = maxBy(snapshot.entries, (entry) => entry.id);
      const entries = newest ? await history(conversation, newest.id) : [];

      const running = snapshot.run !== undefined;

      const transcriber = createTranscriber(await approvalsOf(conversation.id));

      const base = transcriber.replay(entries, running);
      const partial = snapshot.generation?.message;

      const created: Watch = { stream, base, log: [], transcriber };

      if (running && partial) {
        const id = crypto.randomUUID();
        const { text, thinking } = replyText(partial.content);

        created.streaming = {
          id,
          content: structuredClone(partial.content),
          text,
          thinking,
        };
        base.push(
          { type: AgentEventType.AssistantStart, messageId: id },
          {
            type: AgentEventType.AssistantDelta,
            messageId: id,
            channel: DeltaChannel.Thinking,
            delta: thinking,
          },
          {
            type: AgentEventType.AssistantDelta,
            messageId: id,
            channel: DeltaChannel.Text,
            delta: text,
          }
        );
      }

      watchesBySession.set(sessionId, created);
      stream.start(async (events) => handle(created, sessionId, events));

      return created;
    })();

    watches.set(conversation.id, watch);
    watch.catch(() => watches.delete(conversation.id));

    return watch;
  }

  async function detach(id: ConversationId) {
    const watch = watches.get(id);

    watches.delete(id);
    watchesBySession.delete(String(id));
    await (await watch?.catch(() => undefined))?.stream.stop();
  }

  return {
    /**
     * Installs the tools, then continues every run the app's exit cut off. Runs once, as the app
     * starts; until then nothing runs.
     */
    async resume() {
      const { harness } = await opened;

      await toolset.load();

      const { tasks } = await harness.inspect(BACKGROUND_CONTEXT);

      for (const id of new Set(
        tasks.map((task) => task.record.conversationId)
      )) {
        const conversation = await harness.conversation(id, BACKGROUND_CONTEXT);

        if (conversation) await attach(conversation);
      }

      harness.resume();
    },

    /** Most recently active first. */
    async sessions(): Promise<AgentSession[]> {
      const { harness } = await opened;

      const records = await harness.commit(
        (tx) => readAll((cursor) => tx.scanConversations({}, PAGE, cursor)),
        BACKGROUND_CONTEXT
      );

      const sessions = await Promise.all(
        records
          // Conversations a task made, such as a subagent's, belong to their owner.
          .filter((record) => record.owner === undefined)
          .map(async (record) => ({
            id: String(record.id),
            ...((await harness.snapshot(
              SessionDoc,
              record.id,
              BACKGROUND_CONTEXT
            )) ?? SessionDoc.definition.initial()),
            approvalMode: (await approvalsOf(record.id)).mode,
          }))
      );

      return sessions.sort(
        (a, b) => b.updatedAt - a.updatedAt || Number(b.id) - Number(a.id)
      );
    },

    async create(): Promise<AgentSession> {
      const { harness } = await opened;
      const at = Date.now();

      const conversation = await harness.createConversation(
        {
          ownership: { kind: "ownerless" },
          async init(tx, id) {
            const session = await tx.doc(SessionDoc, id);

            session.createdAt = at;
            session.updatedAt = at;
          },
        },
        BACKGROUND_CONTEXT
      );

      return {
        id: String(conversation.id),
        title: "",
        createdAt: at,
        updatedAt: at,
        approvalMode: ApprovalMode.Ask,
      };
    },

    /** Sets how the conversation's calls that must ask get past the gate, from its next call on. */
    async setApprovalMode(sessionId: string, mode: ApprovalMode) {
      const conversation = await conversationOf(sessionId);

      await conversation.commit(async (tx) => {
        (await tx.doc(ApprovalDoc, conversation.id)).mode = mode;
      }, BACKGROUND_CONTEXT);
    },

    /**
     * Everything a renderer needs to show the conversation, including a reply still streaming and
     * calls still waiting for the user.
     */
    async transcript(sessionId: string): Promise<AgentWireEvent[]> {
      const conversation = await conversationOf(sessionId);
      const watch = await watches.get(conversation.id)?.catch(() => undefined);

      if (watch) return [...watch.base, ...watch.log];

      const { harness } = await opened;

      const live = await harness.snapshot(
        LiveDoc,
        conversation.id,
        BACKGROUND_CONTEXT
      );

      return createTranscriber(await approvalsOf(conversation.id)).replay(
        await history(conversation),
        live?.run !== undefined
      );
    },

    /**
     * Starts a run and resolves once it is under way; its progress and outcome arrive as events.
     * Rejects without starting while the conversation is busy or the model is not set up.
     */
    async send(sessionId: string, turn: AgentTurn): Promise<void> {
      const conversation = await conversationOf(sessionId);
      const { harness } = await opened;

      const busy = new Error(
        "The agent is still answering in this conversation"
      );

      if (
        (await harness.snapshot(LiveDoc, conversation.id, BACKGROUND_CONTEXT))
          ?.run
      ) {
        throw busy;
      }

      const { model, thinking } = await options.model();

      await toolset.load();

      await attach(conversation);

      const at = Date.now();

      // The model is the conversation's from here on, so it is set before the input can start a run.
      await conversation.commit(async (tx) => {
        await configure(tx, conversation.id, {
          model: { provider: model.provider, modelId: model.id },
          thinkingLevel: clampThinkingLevel(model, thinking),
        });

        await toolset.offer(tx, conversation.id);

        const session = await tx.doc(SessionDoc, conversation.id);

        session.title ||= firstLine(turn.text, TITLE_LENGTH);
        session.updatedAt = at;
      }, BACKGROUND_CONTEXT);

      try {
        await conversation.submit(
          {
            type: "input",
            content: userContent(turn.text, turn.context),
            whenBusy: "reject",
          },
          BACKGROUND_CONTEXT
        );
      } catch (error) {
        throw error instanceof ConversationBusy ? busy : error;
      }
    },

    approve: gate.approve,

    /** Stops a run; what it streamed so far is kept, ending as aborted. */
    async abort(sessionId: string) {
      await (await conversationOf(sessionId)).abort(BACKGROUND_CONTEXT);
    },

    /** Stops the conversation's run, if one is going, then erases it. */
    async delete(sessionId: string) {
      const conversation = await conversationOf(sessionId);
      const { store } = await opened;

      await conversation.abort(BACKGROUND_CONTEXT);
      await detach(conversation.id);
      await store.deleteConversation(conversation.id);
    },

    /** Closes the store as the app quits; runs still going continue at the next start. */
    async close() {
      await Promise.all([...watches.keys()].map(detach));

      // A store that never opened has nothing to close.
      await (
        await opened.catch(() => undefined)
      )?.harness.close(BACKGROUND_CONTEXT);
    },
  };
}
