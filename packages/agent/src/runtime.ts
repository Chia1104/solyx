import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { clampThinkingLevel } from "@earendil-works/pi-ai";
import type {
  Api,
  AssistantMessage,
  Model,
  Models,
} from "@earendil-works/pi-ai";
import { estimateContextTokens } from "@earendil-works/pi-ai/utils/estimate";
import {
  AssistantEntry,
  CompactionEntry,
  ConversationBusy,
  Harness,
  LiveDoc,
  UserEntry,
  configure,
  createRegistry,
  defineDoc,
} from "@earendil-works/pi-durable";
import type {
  CompactionStatus,
  Conversation,
  ConversationId,
  ConversationView,
  Cursor,
  EntryId,
  EntryRecord,
  HarnessOptions,
  HarnessSettings,
  LiveState,
  NestedToolSlot,
  Observation,
  Page,
  RunFailure,
  Storage,
  SubmissionDraft,
  ToolSlot,
  Tx,
} from "@earendil-works/pi-durable";
import { DEFAULT_IMAGE_LIMITS } from "@earendil-works/pi-durable/tools";
import type {
  ImageLimits,
  ImageProcessor,
} from "@earendil-works/pi-durable/tools";
import { noop } from "es-toolkit";
import * as z from "zod";

import { firstLine } from "@solyx/utils/text";

import {
  ApprovalDoc,
  AskEveryCallDoc,
  createApprovalGate,
} from "./approval.ts";
import type { ToolGuards } from "./approval.ts";
import { AttachmentKind, MAX_TEXT_ATTACHMENT_BYTES } from "./attachment.ts";
import type { ReadAttachment } from "./attachment.ts";
import { agentModelRefSchema, agentThinkingSchema } from "./providers.ts";
import type {
  AgentModelPick,
  AgentModelRef,
  AgentThinking,
} from "./providers.ts";
import { TITLE_LENGTH, titleExtension } from "./title.ts";
import { createToolsetLoader } from "./toolset.ts";
import type { Toolset } from "./toolset.ts";
import {
  carriedFile,
  createTranscriber,
  readTexts,
  replyText,
  scriptCallEnd,
  userContent,
} from "./transcript.ts";
import type { MessageAttachment, Transcriber } from "./transcript.ts";
import {
  AgentEventType,
  ApprovalMode,
  CompactionOutcome,
  DeltaChannel,
  RunEndReason,
} from "./wire.ts";
import type {
  AgentSession,
  AgentSessionSetup,
  AgentWireEvent,
  RunEndEvent,
  SessionSchedule,
} from "./wire.ts";

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
  /**
   * The model a run uses: the conversation's `pick`, or the user's default where it has none.
   * Rejects with a message the user can act on while that model or its key is not set up.
   */
  model(pick: AgentModelPick): Promise<AgentModelChoice>;
  /**
   * The host's tools, built again before every run and before resuming, so a run sees the tools,
   * servers and policies of the moment it starts. A tool that must ask goes through `guard`, so
   * each of its calls waits until the user answers through `approve`, and one the user lets run
   * unasked through `unasked`.
   */
  tools(guards: ToolGuards): Promise<Toolset>;
  /** Where a conversation's shell commands run; without it no tool has an environment. */
  env?: HarnessOptions["env"];
  onEvent(sessionId: string, event: AgentWireEvent): void;
  /**
   * The store failed, so pi-durable closed it: nothing of a conversation is read or written until
   * the app starts again, when the runs this cut off carry on. Called once, after those runs'
   * ends went out.
   */
  onStoreFailure?(cause: unknown): void;
  /** What pi-durable reports went wrong, such as a task that threw or a run the app's exits ended. */
  onReport?: HarnessOptions["onReport"];
  settings?: HarnessSettings;
  /** Scales and re-encodes the images a message carries to fit its model; without it, none rides. */
  images?: ImageProcessor;
  /**
   * Has each conversation's model name it once a run of it has answered, a short request of its
   * own; without it a conversation keeps its first message's first line.
   */
  names?: boolean;
}

/**
 * A file a message carries, where the host keeps it in the conversation's folder. A PDF comes as
 * the text the host read of it, with how many pages it has.
 */
export type AgentAttachment = Exclude<
  ReadAttachment,
  { kind: typeof AttachmentKind.Pdf }
> & {
  /** Where the conversation's folder keeps its text; an image's one copy rides in its message. */
  path?: string;
  pages?: number;
};

const encoder = new TextEncoder();

/** Text short enough to carry inside its message, or else how long it is, for `read_attachment`. */
const carriedText = (text: string) =>
  encoder.encode(text).byteLength <= MAX_TEXT_ATTACHMENT_BYTES
    ? { text }
    : { characters: text.length };

export interface AgentTurn {
  text: string;
  /** The app's context for the model, from `formatContext`. */
  context: string;
  /**
   * Whether its run asks before every call that can ask, whatever the conversation's mode;
   * otherwise it asks as the mode says.
   */
  asksEveryCall?: boolean;
  attachments?: readonly AgentAttachment[];
}

/** pi-durable's limits for an image, narrowed where the model's provider takes less. */
function imageLimits(model: Model<Api>): ImageLimits {
  const resize = model.inputLimits?.images?.resize;

  return {
    maxWidth: resize?.maxWidth ?? DEFAULT_IMAGE_LIMITS.maxWidth,
    maxHeight: resize?.maxHeight ?? DEFAULT_IMAGE_LIMITS.maxHeight,
    maxBytes: resize?.maxBytes ?? DEFAULT_IMAGE_LIMITS.maxBytes,
  };
}

const storedSessionSchema = z.object({
  title: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
  // Version 1 had no model of its own, so every conversation ran on the default.
  model: agentModelRefSchema.nullable().default(null),
  thinking: agentThinkingSchema.nullable().default(null),
});

const SessionDoc = defineDoc<{
  title: string;
  /** The model named it; until then it goes by its first message's first line. */
  named: boolean;
  createdAt: number;
  updatedAt: number;
  model: AgentModelRef | null;
  thinking: AgentThinking | null;
}>({
  kind: "solyx.session",
  version: 3,
  scope: "conversation",
  history: "latest",
  fork: "initial",
  initial: () => ({
    title: "",
    named: false,
    createdAt: 0,
    updatedAt: 0,
    model: null,
    thinking: null,
  }),
  checkpointWhen: () => true,
  // A conversation from before the model named them keeps the name its user knows it by.
  migrate: (value) => ({ ...storedSessionSchema.parse(value), named: true }),
});

/** What started a conversation when the user did not; a fork is the user's own. */
const OriginDoc = defineDoc<{
  schedule: { id: string; name: string } | null;
}>({
  kind: "solyx.origin",
  version: 1,
  scope: "conversation",
  history: "latest",
  fork: "initial",
  initial: () => ({ schedule: null }),
  checkpointWhen: () => true,
});

/** A conversation on the user's default model that asks before every call that must ask. */
const DEFAULT_SETUP: AgentSessionSetup = {
  model: null,
  thinking: null,
  approvalMode: ApprovalMode.Ask,
};

type Block = AssistantMessage["content"][number];

/** A conversation whose events go out as they happen. */
interface Watch {
  /** The conversation's commits as pi-durable adopts them, until detached. */
  observation: Observation<ConversationView>;
  /** The conversation as the observation found it; `transcript` returns it, then `log`. */
  base: AgentWireEvent[];
  /** Every event sent since, consecutive deltas merged. */
  log: AgentWireEvent[];
  /** Read `base` from storage, and turns what is stored since into events. */
  transcriber: Transcriber;
  /** The conversation as of the last commit whose events went out. */
  view: ConversationView;
  /** The newest entry whose events went out; a commit's own entries all follow it. */
  newest?: EntryId;
  /** The reply streaming now, the text and thinking already sent of it and the calls it drafted. */
  streaming?: {
    id: string;
    text: string;
    thinking: string;
    drafted: Set<string>;
  };
  /** The tokens last sent as the next request's context. */
  context?: number;
  /** Settles once the events of every commit taken so far went out. */
  sent: Promise<void>;
}

const BUSY = "The agent is still answering in this conversation";

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

/**
 * The calls a streaming reply began since the last look, each once its id and name have come, so a
 * call shows as the model writes its arguments rather than only once it runs.
 */
function emitDrafts(content: readonly Block[], drafted: Set<string>) {
  const drafts: AgentWireEvent[] = [];

  for (const block of content) {
    if (
      block.type === "toolCall" &&
      block.id &&
      block.name &&
      !drafted.has(block.id)
    ) {
      drafted.add(block.id);
      drafts.push({
        type: AgentEventType.ToolDraft,
        toolCallId: block.id,
        toolName: block.name,
      });
    }
  }

  return drafts;
}

const compactionStart = (status: CompactionStatus): AgentWireEvent => ({
  type: AgentEventType.CompactionStart,
  id: String(status.taskId),
  manual: status.trigger === "manual",
});

/** A view's run and what its reply and tool round show now; empty while it has none of them. */
const liveOf = (view: ConversationView) =>
  // SAFETY: a view keys each built-in document by its kind, so this one holds `pi.live`'s state.
  (view.docs[LiveDoc.definition.kind] ?? {}) as LiveState;

/** What the model called `callId` with, as the reply that made the call holds it. */
function callArguments(view: ConversationView, callId: string) {
  for (let index = view.entries.length - 1; index >= 0; index--) {
    const [stored] = view.entries[index]?.model ?? [];

    if (stored?.role !== "assistant") continue;

    const call = stored.content.find(
      (block) => block.type === "toolCall" && block.id === callId
    );

    if (call?.type === "toolCall") return call.arguments;
  }

  return {};
}

/** What the conversation's next request holds, as pi estimates it; 0 while it holds nothing. */
async function contextTokens(conversation: Conversation) {
  const { messages } = await conversation.context(BACKGROUND_CONTEXT);

  return estimateContextTokens(messages).tokens;
}

type Slot = ToolSlot | NestedToolSlot;

/** The calls of `after` that began to run since `before`, each told from the rest by its `key`. */
function startedSlots<Call extends Slot, Key>(
  before: readonly Call[] = [],
  after: readonly Call[] = [],
  key: (slot: Call) => Key
) {
  if (before === after) return [];

  const running = new Set(
    before.filter((slot) => slot.status === "running").map(key)
  );

  return after.filter(
    (slot) => slot.status === "running" && !running.has(key(slot))
  );
}

/**
 * The calls that ended between `before` and `after`, in the order their lists hold them: one that
 * is done now, as `after` holds it, or one that went unfinished as its run ended, as `before` did.
 */
function endedSlots<Call extends Slot, Key>(
  before: readonly Call[] = [],
  after: readonly Call[] = [],
  key: (slot: Call) => Key
) {
  if (before === after) return [];

  const now = new Map(after.map((slot) => [key(slot), slot]));
  const known = new Set(before.map(key));

  return [
    ...before.flatMap((previous) => {
      if (previous.status === "done") return [];

      const slot = now.get(key(previous));

      if (!slot) return [previous];

      return slot.status === "done" ? [slot] : [];
    }),
    ...after.filter((slot) => slot.status === "done" && !known.has(key(slot))),
  ];
}

/**
 * The run that is still to answer, by the input that started it. A run that answered and only
 * waits for what follows its answer, such as its conversation being named, is over for the thread.
 */
const answering = (live: LiveState | undefined) =>
  live?.run?.afterRun === undefined ? live?.run?.inputs[0] : undefined;

/** The compactions `after` lists that `before` does not. */
const compactionsSince = (before: LiveState, after: LiveState) =>
  (after.compactions ?? []).filter(
    (status) =>
      !(before.compactions ?? []).some(({ taskId }) => taskId === status.taskId)
  );

/** The entries of `view` after `newest`, which a commit appended. */
const entriesAfter = (view: ConversationView, newest: EntryId | undefined) =>
  newest === undefined
    ? view.entries
    : view.entries.filter((entry) => entry.id > newest);

type Emit = (event: AgentWireEvent) => void;

/** Starts a reply under an id of its own, which its deltas and its end name. */
function startReply(watch: Watch, emit: Emit) {
  watch.streaming = {
    id: crypto.randomUUID(),
    text: "",
    thinking: "",
    drafted: new Set(),
  };
  emit({ type: AgentEventType.AssistantStart, messageId: watch.streaming.id });
}

/** Sends what `content` holds of the streaming reply that has not gone out, and the calls it began. */
function sendStreamed(watch: Watch, emit: Emit, content: readonly Block[]) {
  const { streaming } = watch;

  if (!streaming) return;

  const reply = replyText(content);

  for (const channel of [DeltaChannel.Thinking, DeltaChannel.Text]) {
    const sent = streaming[channel];

    // A rewrite of what was sent cannot go out as a delta; the reply's end replaces it whole.
    if (
      reply[channel].length > sent.length &&
      reply[channel].startsWith(sent)
    ) {
      emit({
        type: AgentEventType.AssistantDelta,
        messageId: streaming.id,
        channel,
        delta: reply[channel].slice(sent.length),
      });
      streaming[channel] = reply[channel];
    }
  }

  emitDrafts(content, streaming.drafted).forEach(emit);
}

/**
 * Sends the calls that began to run between `was` and `now`, each with what it runs on: the
 * model's own is in the reply that made it, in `view`, and a script's call carries it.
 */
function sendCallStarts(
  { transcriber }: Watch,
  emit: Emit,
  was: LiveState,
  now: LiveState,
  view: ConversationView
) {
  for (const slot of startedSlots(
    was.tools,
    now.tools,
    (call) => call.callId
  )) {
    transcriber
      .toolStart({
        type: AgentEventType.ToolStart,
        toolCallId: slot.callId,
        toolName: slot.name,
        args: callArguments(view, slot.callId),
      })
      .forEach(emit);
  }

  for (const slot of startedSlots(
    was.nestedTools,
    now.nestedTools,
    (call) => call.taskId
  )) {
    transcriber
      .toolStart({
        type: AgentEventType.ToolStart,
        toolCallId: slot.callId,
        toolName: slot.name,
        args: slot.arguments,
        parentToolCallId: slot.parentCallId,
      })
      .forEach(emit);
  }
}

/** Says a request to the model waits to be sent again, with why it failed, and that the wait is over. */
function sendRetry(emit: Emit, was: LiveState, now: LiveState) {
  const retry = now.generation?.retry;
  const before = was.generation?.retry;

  if (retry && retry !== before) {
    emit({ type: AgentEventType.RetryWait, error: retry.error });
  } else if (!retry && before) {
    emit({ type: AgentEventType.RetryEnd });
  }
}

/** Ends the compactions `now` no longer lists; the commit that ends one without a summary says why. */
function sendCompactionEnds(emit: Emit, was: LiveState, now: LiveState) {
  const failed =
    now.compactionFailure === was.compactionFailure
      ? undefined
      : now.compactionFailure;

  for (const { taskId } of compactionsSince(now, was)) {
    emit({
      type: AgentEventType.CompactionEnd,
      id: String(taskId),
      error: failed?.taskId === taskId ? failed.error : undefined,
    });
  }
}

/** Sends the reply `now` shows streaming: its start where `was` showed none, then what is new of it. */
function sendReply(watch: Watch, emit: Emit, was: LiveState, now: LiveState) {
  const partial = now.generation?.message;
  const before = was.generation?.message;

  if (!partial || partial === before) return;

  if (!before) startReply(watch, emit);

  sendStreamed(watch, emit, partial.content);
}

/** Ends the run `was` shows answering, where `now` shows it over; the commit that ends one without an answer says why. */
function sendRunEnd(watch: Watch, emit: Emit, was: LiveState, now: LiveState) {
  const before = answering(was);

  if (before === undefined || answering(now) === before) return;

  const failure =
    now.runFailure === was.runFailure ? undefined : now.runFailure;

  watch.transcriber.runEnd(failure && failureOf(failure)).forEach(emit);
  watch.streaming = undefined;
}

/** Starts the run `now` shows answering, and says when what followed the last one's answer is over. */
function sendRunStart(
  { transcriber }: Watch,
  emit: Emit,
  was: LiveState,
  now: LiveState
) {
  const run = answering(now);

  if (run !== undefined && run !== answering(was)) {
    transcriber.runStart().forEach(emit);
  }

  // What followed the answer may have named the conversation.
  if (was.run?.afterRun && !now.run) emit({ type: AgentEventType.Named });
}

/**
 * Sends a commit's entries in the order they were appended, and returns the calls they answer. A
 * reply that `streamed` ends the stream begun for it; any other starts as it ends.
 */
function sendEntries(
  watch: Watch,
  emit: Emit,
  entries: readonly EntryRecord[],
  streamed: boolean
) {
  const { transcriber } = watch;
  const answered = new Set<string>();
  let streaming = streamed;

  for (const entry of entries) {
    const [stored] = entry.model ?? [];

    if (stored?.role === "toolResult") answered.add(stored.toolCallId);

    transcriber.toolResult(entry).forEach(emit);

    if (AssistantEntry.is(entry) && stored?.role === "assistant") {
      if (!streaming) {
        startReply(watch, emit);
        sendStreamed(watch, emit, stored.content);
      }

      streaming = false;
      transcriber.message(entry, watch.streaming?.id).forEach(emit);
      watch.streaming = undefined;
    } else if (UserEntry.is(entry) || CompactionEntry.is(entry)) {
      transcriber.message(entry).forEach(emit);
    }
  }

  return answered;
}

/** Why a run ended without an answer, as pi-durable records it, in the run's terms. */
function failureOf({ reason, detail }: RunFailure): RunEndEvent {
  switch (reason) {
    case "aborted":
      return { type: AgentEventType.RunEnd, reason: RunEndReason.Aborted };

    // The app's exits cut the run off as often as pi-durable lets one be.
    case "interrupted":
    case "restart_limit":
      return { type: AgentEventType.RunEnd, reason: RunEndReason.Interrupted };

    case "turn_limit":
      return { type: AgentEventType.RunEnd, reason: RunEndReason.TurnLimit };

    // A model error carries the provider's message; other reasons name themselves.
    default:
      return {
        type: AgentEventType.RunEnd,
        reason: RunEndReason.Error,
        error:
          detail ?? (reason === "no_model" ? "No model is configured" : reason),
      };
  }
}

/**
 * Runs conversations on pi-durable's Harness. Every message and tool call is stored before its
 * event goes out, a reply in progress within a second of it, and a run the app's exit cut off
 * continues from where it stopped once `resume` runs at the next start.
 */
export function createAgentRuntime(options: AgentRuntimeOptions) {
  const { onEvent } = options;

  const registry = createRegistry();
  const watches = new Map<ConversationId, Promise<Watch>>();

  if (options.names) {
    registry.install(
      titleExtension({
        unnamed: async (api, context) =>
          (await api.snapshot(SessionDoc, api.conversationId, context))
            ?.named === false,
        async name(tx, id, title) {
          const session = await tx.doc(SessionDoc, id);

          session.title = title;
          session.named = true;
        },
      })
    );
  }

  // The watches started so far by session id, for the approvals asked in them.
  const watchesBySession = new Map<string, Watch>();

  // The store erases a conversation behind pi-durable, which keeps what it read of one in memory
  // and fails for good on reading the rest from the file. So one erased here is never asked for
  // again; ids are not handed out twice, and nothing is kept past the process.
  const erased = new Set<string>();

  const opened = options.store.then(async (store) => ({
    store,
    harness: await Harness.open(
      store.storage,
      {
        models: options.models,
        registry,
        settings: options.settings,
        env: options.env,
        onReport: options.onReport,
      },
      BACKGROUND_CONTEXT
    ),
  }));

  // A store that fails to open fails every call that waits for it instead.
  opened.catch(noop);

  // A storage error closes the Harness for good, and no commit follows it, so the runs the watches
  // showed are ended here.
  void opened
    .then(async ({ harness }) => {
      const end = await harness.closed;

      if (end.kind !== "failed") return;

      for (const [sessionId, watch] of watchesBySession) {
        watch.observation.detach();
        watch.streaming = undefined;

        for (const event of watch.transcriber.runEnd({
          type: AgentEventType.RunEnd,
          reason: RunEndReason.StoreFailed,
        })) {
          publish(watch, sessionId, event);
        }
      }

      options.onStoreFailure?.(end.error);
    })
    .catch(noop);

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
    options.tools({ guard: gate.guard, unasked: gate.unasked })
  );

  /** The conversation a session id names, if it still names one. */
  async function findConversation(
    sessionId: string
  ): Promise<Conversation | undefined> {
    const { harness } = await opened;

    return /^[1-9]\d*$/.test(sessionId) && !erased.has(sessionId)
      ? // SAFETY: the brand only marks pi-durable's ids; looking the id up checks it names one.
        harness.conversation(
          Number(sessionId) as ConversationId,
          BACKGROUND_CONTEXT
        )
      : undefined;
  }

  async function conversationOf(sessionId: string): Promise<Conversation> {
    const found = await findConversation(sessionId);

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

  /**
   * A message's files as the model takes them. An image is refused for a model that reads none,
   * rather than handed it as a placeholder the user would take for the image.
   */
  async function messageAttachments(
    attachments: readonly AgentAttachment[],
    model: Model<Api>
  ): Promise<MessageAttachment[]> {
    const images = attachments.filter(
      (attachment) => attachment.kind === AttachmentKind.Image
    ).length;

    if (images > 0 && !model.input.includes("image")) {
      throw new Error(
        `${model.name} cannot read images, so pick a model that can before attaching one`
      );
    }

    const most = model.inputLimits?.images?.maxPerMessage;

    if (most !== undefined && images > most) {
      throw new Error(`${model.name} reads at most ${most} images a message`);
    }

    const limits = imageLimits(model);
    const carried: MessageAttachment[] = [];

    // One image at a time, since each decodes every pixel it holds before it is scaled.
    for (const attachment of attachments) {
      const { name, path, mimeType, size } = attachment;

      if (attachment.kind === AttachmentKind.Text) {
        carried.push({
          kind: attachment.kind,
          name,
          path,
          mimeType,
          size,
          pages: attachment.pages,
          ...carriedText(attachment.text),
        });

        continue;
      }

      const prepared = await options.images?.prepare(
        attachment.data,
        mimeType,
        limits
      );

      if (!prepared) {
        throw new Error(`${attachment.name} could not be read as an image`);
      }

      carried.push({
        kind: attachment.kind,
        name,
        mimeType,
        size,
        image: {
          type: "image",
          data: prepared.data,
          mimeType: prepared.mimeType,
        },
      });
    }

    return carried;
  }

  /** The model and thinking the conversation's next request runs on, once the host resolves them. */
  async function choiceOf(id: ConversationId) {
    const { harness } = await opened;

    const session =
      (await harness.snapshot(SessionDoc, id, BACKGROUND_CONTEXT)) ??
      SessionDoc.definition.initial();

    return options.model({ model: session.model, thinking: session.thinking });
  }

  /** Sets the model of the conversation's next request, which a compaction uses too. */
  async function configureModel(
    tx: Tx,
    id: ConversationId,
    { model, thinking }: AgentModelChoice
  ) {
    await configure(tx, id, {
      model: { provider: model.provider, modelId: model.id },
      thinkingLevel: clampThinkingLevel(model, thinking),
    });
  }

  /** The conversation's run and what it shows now, as last committed; nothing before its first run. */
  async function liveState(id: ConversationId) {
    const { harness } = await opened;

    return harness.snapshot(LiveDoc, id, BACKGROUND_CONTEXT);
  }

  /**
   * Ends what a run that answered still does, such as naming its conversation, so the conversation
   * takes what comes next at once; the next answer has it named instead.
   */
  async function settle(conversation: Conversation) {
    const live = await liveState(conversation.id);

    if (live?.run?.afterRun) await conversation.abort(BACKGROUND_CONTEXT);
  }

  /**
   * Admits what starts a run in the commit that stores what the run goes on: the model, the tools
   * and whether it asks before every call. A conversation that turned busy meanwhile refuses it,
   * and the commit with it, so nothing changes a run that is not its own. `title` names a
   * conversation that has no name yet.
   */
  async function admit(
    conversation: Conversation,
    choice: AgentModelChoice,
    draft: SubmissionDraft,
    asksEveryCall = false,
    title?: string
  ) {
    await toolset.load();
    await attach(conversation);
    await settle(conversation);

    const at = Date.now();

    try {
      await conversation.commit(async (tx) => {
        await conversation.submit(tx, draft);
        await configureModel(tx, conversation.id, choice);
        await toolset.offer(tx, conversation.id);

        const session = await tx.doc(SessionDoc, conversation.id);

        if (title) session.title ||= title;

        session.updatedAt = at;
        (await tx.doc(AskEveryCallDoc, conversation.id)).asks = asksEveryCall;
      }, BACKGROUND_CONTEXT);
    } catch (error) {
      throw error instanceof ConversationBusy ? new Error(BUSY) : error;
    }
  }

  /** The conversation's approval mode and what its calls that asked were answered. */
  async function approvalsOf(id: ConversationId) {
    const { harness } = await opened;

    return (
      (await harness.snapshot(ApprovalDoc, id, BACKGROUND_CONTEXT)) ??
      ApprovalDoc.definition.initial()
    );
  }

  /** How a call a script made ended: stopped where pi-durable aborted it, else as it says. */
  async function nestedEnd(slot: NestedToolSlot) {
    const call = { toolCallId: slot.callId, toolName: slot.name };

    if (!slot.summary?.isError) return scriptCallEnd(call, slot.summary);

    const { harness } = await opened;
    const task = await harness.getTask(slot.taskId, BACKGROUND_CONTEXT);

    return scriptCallEnd(
      call,
      slot.summary,
      task?.state.outcome?.status === "aborted"
    );
  }

  /**
   * Sends the events of one commit: what `next` shows that the view before it did not, in the
   * order a renderer folds them. The context the commit leaves goes out first, so a run's end
   * stays its last event.
   */
  async function step(
    watch: Watch,
    conversation: Conversation,
    next: ConversationView
  ) {
    const { transcriber } = watch;

    const emit: Emit = (event) =>
      publish(watch, String(conversation.id), event);

    const was = liveOf(watch.view);
    const now = liveOf(next);
    const entries = entriesAfter(next, watch.newest);

    watch.view = next;
    watch.newest = entries.at(-1)?.id ?? watch.newest;

    // The model's own calls that ended in this commit.
    const ended = endedSlots(was.tools, now.tools, (slot) => slot.callId);

    // A script's call returns to its script, so only an entry or a call of the model's own
    // changes what the next request holds.
    if (entries.length > 0 || ended.length > 0) {
      const tokens = await contextTokens(conversation);

      if (tokens !== watch.context) {
        watch.context = tokens;
        emit({ type: AgentEventType.Context, tokens });
      }
    }

    sendCallStarts(watch, emit, was, now, next);
    sendRetry(emit, was, now);
    sendReply(watch, emit, was, now);

    // Children before the calls that made them: the list holds parents first.
    for (const slot of endedSlots(
      was.nestedTools,
      now.nestedTools,
      (call) => call.taskId
    ).reverse()) {
      transcriber.toolEnd(await nestedEnd(slot)).forEach(emit);
    }

    const answered = sendEntries(
      watch,
      emit,
      entries,
      was.generation?.message !== undefined
    );

    // A call that ended without a result: its task failed where it could not say so, or its run
    // ended first.
    for (const slot of ended.filter(({ callId }) => !answered.has(callId))) {
      transcriber
        .toolEnd(
          scriptCallEnd(
            { toolCallId: slot.callId, toolName: slot.name },
            undefined
          )
        )
        .forEach(emit);
    }

    sendCompactionEnds(emit, was, now);

    sendRunEnd(watch, emit, was, now);
    compactionsSince(was, now).map(compactionStart).forEach(emit);
    sendRunStart(watch, emit, was, now);
  }

  /** Starts sending a conversation's events, before any run of it starts. */
  function attach(conversation: Conversation): Promise<Watch> {
    const attached = watches.get(conversation.id);

    if (attached) return attached;

    const sessionId = String(conversation.id);

    const watch = (async (): Promise<Watch> => {
      const { harness } = await opened;

      // Commits that arrive before the watch can send them wait here, in order.
      const waiting: ConversationView[] = [];

      let take = (view: ConversationView) => {
        waiting.push(view);
      };

      const observation = await harness.observeConversation(
        conversation.id,
        {
          // Called as pi-durable adopts a commit, where nothing may wait or throw, so the commit
          // is only kept for `step`.
          advance(call) {
            if (call.kind === "value") take(call.value);
          },
          end: noop,
        },
        BACKGROUND_CONTEXT
      );

      try {
        const view = observation.value;
        const live = liveOf(view);

        // Stored entries never change and ids only grow, so the history up to the newest entry
        // the view holds is the conversation as it was found; later entries arrive with their
        // commits.
        const newest = view.entries.at(-1)?.id;

        const entries =
          newest === undefined ? [] : await history(conversation, newest);

        const running = answering(live) !== undefined;

        const transcriber = createTranscriber(
          await approvalsOf(conversation.id)
        );

        const base = transcriber.replay(
          entries,
          running,
          live.runFailure && failureOf(live.runFailure)
        );

        const partial = live.generation?.message;

        base.push(...(live.compactions ?? []).map(compactionStart));

        if (live.generation?.retry) {
          base.push({
            type: AgentEventType.RetryWait,
            error: live.generation.retry.error,
          });
        }

        const context = await contextTokens(conversation);

        if (context > 0)
          base.push({ type: AgentEventType.Context, tokens: context });

        const created: Watch = {
          observation,
          base,
          log: [],
          transcriber,
          view,
          newest,
          context,
          sent: Promise.resolve(),
        };

        if (running && partial) {
          const id = crypto.randomUUID();
          const { text, thinking } = replyText(partial.content);
          const drafted = new Set<string>();

          created.streaming = { id, text, thinking, drafted };
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
            },
            ...emitDrafts(partial.content, drafted)
          );
        }

        watchesBySession.set(sessionId, created);

        // One commit at a time, each after the one before it. A commit whose events cannot be
        // sent is reported as a listener's failure, and the ones after it still go out.
        take = (next) => {
          created.sent = created.sent
            .then(() => step(created, conversation, next))
            .catch((error) =>
              options.onReport?.({ kind: "listener_error", error })
            );
        };

        waiting.forEach(take);

        return created;
      } catch (error) {
        observation.detach();

        throw error;
      }
    })();

    watches.set(conversation.id, watch);
    watch.catch(() => watches.delete(conversation.id));

    return watch;
  }

  /** Stops sending a conversation's events, once those of the commits already taken went out. */
  async function detach(id: ConversationId) {
    const watch = await watches.get(id)?.catch(() => undefined);

    watches.delete(id);
    watchesBySession.delete(String(id));
    watch?.observation.detach();
    await watch?.sent;
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
          .map(async (record) => {
            // Who named a conversation is the runtime's own to know.
            const { named: _named, ...session } =
              (await harness.snapshot(
                SessionDoc,
                record.id,
                BACKGROUND_CONTEXT
              )) ?? SessionDoc.definition.initial();

            return {
              id: String(record.id),
              ...session,
              approvalMode: (await approvalsOf(record.id)).mode,
              schedule:
                (
                  await harness.snapshot(
                    OriginDoc,
                    record.id,
                    BACKGROUND_CONTEXT
                  )
                )?.schedule ?? null,
            };
          })
      );

      return sessions.sort(
        (a, b) => b.updatedAt - a.updatedAt || Number(b.id) - Number(a.id)
      );
    },

    /**
     * Starts a conversation on what was picked for it, in the same commit that makes it.
     * `schedule` names the scheduled task that starts it, and `maxTurns` the tool rounds a run of
     * it takes at most, both of which only the host can say.
     */
    async create(
      setup = DEFAULT_SETUP,
      schedule: SessionSchedule | null = null,
      maxTurns?: number
    ): Promise<AgentSession> {
      const { harness } = await opened;
      const at = Date.now();

      const conversation = await harness.createConversation(
        {
          ownership: { kind: "ownerless" },
          async init(tx, id) {
            const session = await tx.doc(SessionDoc, id);

            session.createdAt = at;
            session.updatedAt = at;
            session.model = setup.model;
            session.thinking = setup.thinking;
            (await tx.doc(ApprovalDoc, id)).mode = setup.approvalMode;

            if (schedule) (await tx.doc(OriginDoc, id)).schedule = schedule;

            if (maxTurns !== undefined) await configure(tx, id, { maxTurns });
          },
        },
        BACKGROUND_CONTEXT
      );

      return {
        id: String(conversation.id),
        title: "",
        createdAt: at,
        updatedAt: at,
        ...setup,
        schedule,
      };
    },

    /**
     * Whether a run is going in the conversation, one waiting for the user among them; a
     * conversation since deleted has none.
     */
    async busy(sessionId: string): Promise<boolean> {
      const conversation = await findConversation(sessionId);

      return (
        conversation !== undefined &&
        answering(await liveState(conversation.id)) !== undefined
      );
    },

    /** Sets what the conversation runs on from its next run: a model of its own, or the default. */
    async setModel(sessionId: string, pick: AgentModelPick) {
      const conversation = await conversationOf(sessionId);

      await conversation.commit(async (tx) => {
        const session = await tx.doc(SessionDoc, conversation.id);

        session.model = pick.model;
        session.thinking = pick.thinking;
      }, BACKGROUND_CONTEXT);
    },

    /** Sets how the conversation's calls that must ask get past the gate, from its next call on. */
    async setApprovalMode(sessionId: string, mode: ApprovalMode) {
      const conversation = await conversationOf(sessionId);

      await conversation.commit(async (tx) => {
        (await tx.doc(ApprovalDoc, conversation.id)).mode = mode;
      }, BACKGROUND_CONTEXT);
    },

    /** The file a user message carried as its `index`th, as the one copy kept of it. */
    async carriedFile(sessionId: string, messageId: string, index: number) {
      const conversation = await conversationOf(sessionId);
      // SAFETY: a message's wire id is its entry's id written out, as `./transcript` writes it.
      const id = Number(messageId) as EntryId;

      const { items } = await conversation.entries(
        { minEntryId: id, maxEntryId: id },
        1,
        undefined,
        BACKGROUND_CONTEXT
      );

      const entry = items[0];
      const [stored] = entry?.model ?? [];

      return entry && UserEntry.is(entry) && stored?.role === "user"
        ? carriedFile(stored, index)
        : undefined;
    },

    /** Everything a conversation's tools returned and its user wrote, oldest first, what a compaction no longer shows the model among it. */
    async read(sessionId: string): Promise<string[]> {
      return readTexts(await history(await conversationOf(sessionId)));
    },

    /**
     * Everything a renderer needs to show the conversation, including a reply still streaming and
     * calls still waiting for the user.
     */
    async transcript(sessionId: string): Promise<AgentWireEvent[]> {
      const conversation = await conversationOf(sessionId);
      const watch = await watches.get(conversation.id)?.catch(() => undefined);

      if (watch) return [...watch.base, ...watch.log];

      const live = await liveState(conversation.id);

      const events = [
        ...createTranscriber(await approvalsOf(conversation.id)).replay(
          await history(conversation),
          answering(live) !== undefined,
          live?.runFailure && failureOf(live.runFailure)
        ),
        ...(live?.compactions ?? []).map(compactionStart),
      ];

      const context = await contextTokens(conversation);

      if (context > 0)
        events.push({ type: AgentEventType.Context, tokens: context });

      return events;
    },

    /**
     * Starts a run and resolves once it is under way; its progress and outcome arrive as events.
     * Rejects without starting while the conversation is busy or the model is not set up.
     */
    async send(sessionId: string, turn: AgentTurn): Promise<void> {
      const conversation = await conversationOf(sessionId);
      const live = await liveState(conversation.id);

      if (answering(live) !== undefined) throw new Error(BUSY);

      const choice = await choiceOf(conversation.id);

      const attachments = await messageAttachments(
        turn.attachments ?? [],
        choice.model
      );

      await admit(
        conversation,
        choice,
        {
          type: "input",
          content: userContent(turn.text, turn.context, attachments),
          whenBusy: "reject",
        },
        turn.asksEveryCall,
        firstLine(turn.text, TITLE_LENGTH)
      );
    },

    /**
     * Starts a run on the conversation as it stands, without a new message, as after a run that
     * ended without an answer, and resolves once it is under way. Rejects without starting while
     * the conversation is busy or the model is not set up. A conversation whose last reply
     * answered has nothing to carry on from, so its run ends at once, saying so.
     */
    async continue(sessionId: string, asksEveryCall = false): Promise<void> {
      const conversation = await conversationOf(sessionId);

      await admit(
        conversation,
        await choiceOf(conversation.id),
        { type: "continue" },
        asksEveryCall
      );
    },

    approve: gate.approve,

    /**
     * Summarizes the conversation's older messages on the model its next run would use, keeping
     * the latest as they are, and resolves once the summary is placed or nothing is old enough;
     * stopping the conversation stops it. Rejects without starting while a run or another
     * compaction the user asked for is going, or the model is not set up, and with the provider's
     * message when the summary fails.
     */
    async compact(
      sessionId: string,
      instructions?: string
    ): Promise<CompactionOutcome> {
      const conversation = await conversationOf(sessionId);
      const { harness } = await opened;

      const live = await liveState(conversation.id);

      if (answering(live) !== undefined) throw new Error(BUSY);

      if (
        (live?.compactions ?? []).some((status) => status.trigger === "manual")
      ) {
        throw new Error("The conversation is already being summarized");
      }

      const choice = await choiceOf(conversation.id);

      await attach(conversation);
      await settle(conversation);
      await conversation.commit(
        (tx) => configureModel(tx, conversation.id, choice),
        BACKGROUND_CONTEXT
      );

      const task = await conversation.compact(instructions, BACKGROUND_CONTEXT);

      const { outcome } = (await harness.waitForTask(task, BACKGROUND_CONTEXT))
        .state;

      switch (outcome.status) {
        case "completed":
          return outcome.result.submissionId === undefined &&
            outcome.result.entryId === undefined
            ? CompactionOutcome.NothingOld
            : CompactionOutcome.Summarized;
        case "aborted":
          return CompactionOutcome.Stopped;
        case "failed":
        case "faulted":
          throw new Error(outcome.error.message);
        default:
          throw new Error(outcome.reason);
      }
    },

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
      erased.add(sessionId);
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
