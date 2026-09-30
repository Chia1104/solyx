import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { contentText } from "@earendil-works/pi-ai";
import type {
  AssistantMessage,
  ToolResultMessage,
  UserMessage,
} from "@earendil-works/pi-ai";

import { AgentEventType, RunEndReason, ToolCallStatus } from "./wire.ts";
import type { AgentWireEvent } from "./wire.ts";

/** One conversation with the agent. */
export interface AgentSession {
  id: string;
  /** Empty until the first message names it. */
  title: string;
  createdAt: number;
  updatedAt: number;
}

/** A persisted message; `id` is also its wire `messageId`, live and replayed alike. */
export interface TranscriptEntry {
  id: string;
  message: AgentMessage;
}

/** Where conversations persist. Synchronous, so a message is stored before its event is sent. */
export interface AgentSessionStore {
  /** Most recently active first. */
  list(): AgentSession[];
  get(id: string): AgentSession | undefined;
  create(session: AgentSession): void;
  /** Replaces the stored session with the same id. */
  update(session: AgentSession): void;
  /** Drops the session and its transcript. */
  delete(id: string): void;
  /** Oldest first. */
  entries(sessionId: string): TranscriptEntry[];
  append(sessionId: string, entry: TranscriptEntry): void;
}

// The app's context rides in the user message it belongs to, so a replayed transcript sends the
// provider the same bytes again and its prompt cache holds.
const CONTEXT_OPEN = "<app_context>";

const CONTEXT_CLOSE = "</app_context>";

const CONTEXT_BLOCK = /^<app_context>\n[\s\S]*?\n<\/app_context>\n/;

/** What the user typed, preceded by the app's context for the model. */
export function userMessage(
  text: string,
  context: string,
  timestamp: number
): UserMessage {
  return {
    role: "user",
    content: [
      { type: "text", text: `${CONTEXT_OPEN}\n${context}\n${CONTEXT_CLOSE}` },
      { type: "text", text },
    ],
    timestamp,
  };
}

/** What the user typed, without the context the app attached. */
export function userText(message: UserMessage): string {
  return contentText(message.content).replace(CONTEXT_BLOCK, "");
}

export function assistantEndEvent(
  messageId: string,
  message: AssistantMessage
): AgentWireEvent {
  const thinking = message.content
    .flatMap((part) => (part.type === "thinking" ? [part.thinking] : []))
    .join("");

  return {
    type: AgentEventType.AssistantEnd,
    messageId,
    text: contentText(message.content, ""),
    thinking: thinking || undefined,
    at: message.timestamp,
  };
}

/** How a run ended if this reply ends it; `undefined` while it goes on to run tools. */
export function runEndOf(
  message: AssistantMessage
): Extract<AgentWireEvent, { type: typeof AgentEventType.RunEnd }> | undefined {
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

/** The first line of a failed call's text, kept to one short line. */
function failureLine(text: string): string {
  const [line = ""] = text.split("\n");

  return line.length > 160 ? `${line.slice(0, 160)}…` : line;
}

export function toolEndEvent(
  result: Pick<
    ToolResultMessage,
    "toolCallId" | "toolName" | "isError" | "content" | "details"
  >
): AgentWireEvent {
  return {
    type: AgentEventType.ToolEnd,
    toolCallId: result.toolCallId,
    toolName: result.toolName,
    status: result.isError ? ToolCallStatus.Error : ToolCallStatus.Ok,
    error: result.isError
      ? failureLine(contentText(result.content))
      : undefined,
    details: result.details,
  };
}

/**
 * Rebuilds a transcript's wire events so a renderer that opens a conversation folds it like the
 * live stream. A completed reply arrives whole, without deltas. Calls whose results never came
 * are closed as aborted, and a transcript that stops mid-run ends as interrupted, unless the run
 * is still `running`.
 */
export function transcriptEvents(
  entries: readonly TranscriptEntry[],
  running: boolean
): AgentWireEvent[] {
  const events: AgentWireEvent[] = [];
  let open = new Map<string, string>();
  let inRun = false;

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

  for (const { id, message } of entries) {
    if (message.role !== "toolResult") closeOpen();

    switch (message.role) {
      case "user":
        if (inRun) {
          events.push({
            type: AgentEventType.RunEnd,
            reason: RunEndReason.Interrupted,
          });
        }

        events.push(
          { type: AgentEventType.RunStart },
          {
            type: AgentEventType.User,
            messageId: id,
            text: userText(message),
            at: message.timestamp,
          }
        );
        inRun = true;
        break;

      case "assistant": {
        events.push(assistantEndEvent(id, message));

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

        const end = runEndOf(message);

        if (end) {
          events.push(end);
          inRun = false;
        }

        break;
      }

      case "toolResult":
        events.push(toolEndEvent(message));
        open.delete(message.toolCallId);
        break;

      default:
        break;
    }
  }

  if (running) {
    // A run that has not stored its user message yet still shows as running.
    if (!inRun) events.push({ type: AgentEventType.RunStart });
  } else {
    closeOpen();

    if (inRun) {
      events.push({
        type: AgentEventType.RunEnd,
        reason: RunEndReason.Interrupted,
      });
    }
  }

  return events;
}
