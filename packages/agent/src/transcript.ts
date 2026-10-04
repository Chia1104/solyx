import { contentText } from "@earendil-works/pi-ai";
import type {
  AssistantMessage,
  ToolResultMessage,
  UserMessage,
} from "@earendil-works/pi-ai";
import {
  AssistantEntry,
  ToolResultEntry,
  UserEntry,
} from "@earendil-works/pi-durable";
import type { EntryRecord } from "@earendil-works/pi-durable";

import { approvalEvents } from "./approval.ts";
import type { ApprovalAnswers, ApprovalEvent } from "./approval.ts";
import { firstLine } from "./text.ts";
import { AgentEventType, RunEndReason, ToolCallStatus } from "./wire.ts";
import type {
  AgentWireEvent,
  RunEndEvent,
  ToolEndEvent,
  ToolStartEvent,
} from "./wire.ts";

// The app's context rides in the user message it belongs to, so a replayed transcript sends the
// provider the same bytes again and its prompt cache holds.
const CONTEXT_OPEN = "<app_context>";

const CONTEXT_CLOSE = "</app_context>";

const CONTEXT_BLOCK = /^<app_context>\n[\s\S]*?\n<\/app_context>\n/;

/** What the user typed, preceded by the app's context for the model. */
export function userContent(
  text: string,
  context: string
): UserMessage["content"] {
  return [
    { type: "text", text: `${CONTEXT_OPEN}\n${context}\n${CONTEXT_CLOSE}` },
    { type: "text", text },
  ];
}

/** What the user typed, without the context the app attached. */
export function userText(message: UserMessage): string {
  return contentText(message.content).replace(CONTEXT_BLOCK, "");
}

/** The wire id of a stored message, live and replayed alike. */
const messageId = (entry: EntryRecord) => String(entry.id);

/** A reply's text and its thinking, each with its parts joined as they streamed. */
export function replyText(
  content: readonly AssistantMessage["content"][number][]
) {
  return {
    text: contentText(content, ""),
    thinking: content
      .flatMap((part) => (part.type === "thinking" ? [part.thinking] : []))
      .join(""),
  };
}

function assistantEndEvent(
  messageId: string,
  message: AssistantMessage
): AgentWireEvent {
  const { text, thinking } = replyText(message.content);

  return {
    type: AgentEventType.AssistantEnd,
    messageId,
    text,
    thinking: thinking || undefined,
    at: message.timestamp,
  };
}

/**
 * How a reply ends its run; `undefined` while the run goes on to run tools. A reply that failed or
 * was cut short may still be followed by a retry or by the run resuming after a restart, so its
 * end holds only once nothing follows it in the run.
 */
function runEndOf(message: AssistantMessage): RunEndEvent | undefined {
  switch (message.stopReason) {
    case "toolUse":
    case "pending":
    case "deferred":
      return undefined;
    case "error":
      return {
        type: AgentEventType.RunEnd,
        reason: RunEndReason.Error,
        error: message.errorMessage,
      };
    case "aborted":
      return { type: AgentEventType.RunEnd, reason: RunEndReason.Aborted };
    default:
      return { type: AgentEventType.RunEnd, reason: RunEndReason.Done };
  }
}

// Results pi-durable writes for calls that never finished: stopped with their run, or cut off by
// the app exiting while they ran.
const UNFINISHED = new Set(["aborted", "interrupted"]);

/** Whether a stored tool result stands for a call that never finished. */
function isUnfinished(entry: EntryRecord): boolean {
  return (
    ToolResultEntry.is(entry) &&
    entry.data.diagnostics.some((diagnostic) =>
      UNFINISHED.has(diagnostic.code ?? "")
    )
  );
}

/** The end of the call a stored tool result answers; `undefined` for any other entry. */
function toolEndEvent(entry: EntryRecord): ToolEndEvent | undefined {
  const [message] = entry.model ?? [];

  if (!ToolResultEntry.is(entry) || message?.role !== "toolResult") {
    return undefined;
  }

  const result: ToolResultMessage = message;

  const status = isUnfinished(entry)
    ? ToolCallStatus.Aborted
    : result.isError
      ? ToolCallStatus.Error
      : ToolCallStatus.Ok;

  const diagnosed = entry.data.diagnostics.find(
    (diagnostic) => diagnostic.severity === "error"
  );

  return {
    type: AgentEventType.ToolEnd,
    toolCallId: result.toolCallId,
    toolName: result.toolName,
    status,
    error:
      status === ToolCallStatus.Error
        ? firstLine(diagnosed?.message ?? contentText(result.content), 160)
        : undefined,
    details: result.details,
  };
}

/**
 * Turns a conversation's stored entries and its runs' boundaries into wire events, so a renderer
 * folds a transcript read from storage like the live stream. `replay` reads what storage holds,
 * and the other methods carry on from there as a run goes on, so both follow the same rules. A
 * completed reply arrives whole, without deltas, and a call that asked the user is followed by its
 * question and the answer.
 */
export function createTranscriber(approvals: ApprovalAnswers) {
  /** Calls whose start went out and whose result has not, with their tool's name. */
  let open = new Map<string, string>();
  /** Approval events waiting for their call's start to go out, which arrives with its commit. */
  const held = new Map<string, ApprovalEvent[]>();
  let inRun = false;
  // How the run ends if nothing follows: a reply that failed or was cut short, or a call stopped
  // with its run.
  let pending: RunEndEvent | undefined;

  /** Closes the calls whose results never came. */
  function closeOpen(): AgentWireEvent[] {
    const events = [...open].map(([toolCallId, toolName]): AgentWireEvent => ({
      type: AgentEventType.ToolEnd,
      toolCallId,
      toolName,
      status: ToolCallStatus.Aborted,
    }));

    open = new Map();

    return events;
  }

  function runStart(): AgentWireEvent[] {
    inRun = true;
    pending = undefined;

    return [{ type: AgentEventType.RunStart }];
  }

  /** Ends the run under way, if any: as its last reply or stopped call says, else as `failure`. */
  function runEnd(failure?: RunEndEvent): AgentWireEvent[] {
    const events = closeOpen();

    if (inRun) {
      events.push(
        pending ??
          failure ?? {
            type: AgentEventType.RunEnd,
            reason: RunEndReason.Interrupted,
          }
      );
    }

    inRun = false;
    pending = undefined;

    return events;
  }

  /** A stored user message or reply; `id` names a reply that streamed under an id of its own. */
  function message(
    entry: EntryRecord,
    id = messageId(entry)
  ): AgentWireEvent[] {
    const [stored] = entry.model ?? [];

    if (UserEntry.is(entry) && stored?.role === "user") {
      return [
        {
          type: AgentEventType.User,
          messageId: id,
          text: userText(stored),
          at: stored.timestamp,
        },
      ];
    }

    if (AssistantEntry.is(entry) && stored?.role === "assistant") {
      pending = runEndOf(stored);

      return [...closeOpen(), assistantEndEvent(id, stored)];
    }

    return [];
  }

  function toolStart(event: ToolStartEvent): AgentWireEvent[] {
    const { toolCallId } = event;
    const asked = held.get(toolCallId) ?? approvalEvents(approvals, toolCallId);

    open.set(toolCallId, event.toolName);
    held.delete(toolCallId);

    return [event, ...asked];
  }

  function toolEnd(event: ToolEndEvent): AgentWireEvent[] {
    open.delete(event.toolCallId);

    return [event];
  }

  /** The end of the call a stored tool result answers; nothing for any other entry. */
  function toolResult(entry: EntryRecord): AgentWireEvent[] {
    const event = toolEndEvent(entry);

    if (!event) return [];

    if (event.status === ToolCallStatus.Aborted) {
      pending = { type: AgentEventType.RunEnd, reason: RunEndReason.Aborted };
    }

    return toolEnd(event);
  }

  return {
    runStart,
    runEnd,
    message,
    toolStart,
    toolEnd,
    toolResult,

    /** A question or its answer as it happens, which follows its call's start. */
    approval(event: ApprovalEvent): AgentWireEvent[] {
      if (open.has(event.toolCallId)) return [event];

      held.set(event.toolCallId, [
        ...(held.get(event.toolCallId) ?? []),
        event,
      ]);

      return [];
    },

    /**
     * The events of stored entries, oldest first. Unless the conversation is `running`, calls
     * whose results never came are closed as aborted, and a run that stops short ends as
     * interrupted.
     */
    replay(
      entries: readonly EntryRecord[],
      running: boolean
    ): AgentWireEvent[] {
      const events: AgentWireEvent[] = [];

      for (const entry of entries) {
        const [stored] = entry.model ?? [];

        if (UserEntry.is(entry) && stored?.role === "user") {
          events.push(...runEnd(), ...runStart());
        }

        events.push(...message(entry), ...toolResult(entry));

        if (AssistantEntry.is(entry) && stored?.role === "assistant") {
          for (const part of stored.content) {
            if (part.type !== "toolCall") continue;

            events.push(
              ...toolStart({
                type: AgentEventType.ToolStart,
                toolCallId: part.id,
                toolName: part.name,
                args: part.arguments,
              })
            );
          }

          if (pending?.reason === RunEndReason.Done) events.push(...runEnd());
        }
      }

      if (!running) events.push(...runEnd());
      // A run that has not stored its user message yet still shows as running.
      else if (!inRun) events.push(...runStart());

      return events;
    },
  };
}

export type Transcriber = ReturnType<typeof createTranscriber>;
