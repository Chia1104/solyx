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

import { firstLine } from "./text.ts";
import { AgentEventType, RunEndReason, ToolCallStatus } from "./wire.ts";
import type { AgentWireEvent, RunEndEvent, ToolEndEvent } from "./wire.ts";

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
export const messageId = (entry: EntryRecord) => String(entry.id);

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

export function assistantEndEvent(
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
export function runEndOf(message: AssistantMessage): RunEndEvent | undefined {
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
export function toolEndEvent(entry: EntryRecord): ToolEndEvent | undefined {
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
 * Rebuilds a transcript's wire events, oldest entry first, so a renderer that opens a
 * conversation folds it like the live stream. A completed reply arrives whole, without deltas.
 * Unless the conversation is `running`, calls whose results never came are closed as aborted,
 * and a run that stops short ends as interrupted.
 */
export function transcriptEvents(
  entries: readonly EntryRecord[],
  running: boolean
): AgentWireEvent[] {
  const events: AgentWireEvent[] = [];
  let open = new Map<string, string>();
  let inRun = false;
  // How the run ends if nothing follows: a reply that failed or was cut short, or a call stopped
  // with its run.
  let pending: RunEndEvent | undefined;

  const closeOpen = () => {
    for (const [toolCallId, toolName] of open) {
      events.push({
        type: AgentEventType.ToolEnd,
        toolCallId,
        toolName,
        status: ToolCallStatus.Aborted,
      });
    }

    open = new Map();
  };

  const endRun = () => {
    closeOpen();

    if (inRun) {
      events.push(
        pending ?? {
          type: AgentEventType.RunEnd,
          reason: RunEndReason.Interrupted,
        }
      );
    }

    inRun = false;
    pending = undefined;
  };

  for (const entry of entries) {
    const [message] = entry.model ?? [];

    if (UserEntry.is(entry) && message?.role === "user") {
      endRun();
      events.push(
        { type: AgentEventType.RunStart },
        {
          type: AgentEventType.User,
          messageId: messageId(entry),
          text: userText(message),
          at: message.timestamp,
        }
      );
      inRun = true;
    } else if (AssistantEntry.is(entry) && message?.role === "assistant") {
      closeOpen();
      events.push(assistantEndEvent(messageId(entry), message));

      for (const part of message.content) {
        if (part.type !== "toolCall") continue;

        events.push({
          type: AgentEventType.ToolStart,
          toolCallId: part.id,
          toolName: part.name,
          args: part.arguments,
        });
        open.set(part.id, part.name);
      }

      pending = runEndOf(message);

      if (pending?.reason === RunEndReason.Done) endRun();
    } else {
      const toolEnd = toolEndEvent(entry);

      if (toolEnd) {
        events.push(toolEnd);
        open.delete(toolEnd.toolCallId);

        if (toolEnd.status === ToolCallStatus.Aborted) {
          pending = {
            type: AgentEventType.RunEnd,
            reason: RunEndReason.Aborted,
          };
        }
      }
    }
  }

  if (running) {
    // A run that has not stored its user message yet still shows as running.
    if (!inRun) events.push({ type: AgentEventType.RunStart });
  } else {
    endRun();
  }

  return events;
}
