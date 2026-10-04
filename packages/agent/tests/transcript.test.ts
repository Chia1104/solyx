import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import type { Message } from "@earendil-works/pi-ai";
import {
  AssistantEntry,
  ToolResultEntry,
  UserEntry,
} from "@earendil-works/pi-durable";
import type {
  ConversationId,
  EntryId,
  EntryRecord,
  ToolDiagnostic,
} from "@earendil-works/pi-durable";
import { expect, test } from "vite-plus/test";

import { createTranscriber, userContent, userText } from "../src/transcript.ts";
import {
  AgentEventType,
  RunEndReason,
  ToolCallStatus,
  foldEvents,
} from "../src/wire.ts";

/** A transcript read from storage in which no call asked the user. */
const transcriptEvents = (entries: readonly EntryRecord[], running: boolean) =>
  createTranscriber({}).replay(entries, running);

function entry(
  id: number,
  kind: string,
  message: Message,
  data?: EntryRecord["data"]
): EntryRecord {
  // SAFETY: tests number entries and conversations the way pi-durable's storage does.
  return {
    id: id as EntryId,
    conversationId: 1 as ConversationId,
    kind,
    model: [message],
    data,
  };
}

const user = (id: number, text: string) =>
  entry(id, UserEntry.kind, {
    role: "user",
    content: userContent(text, "time: now"),
    timestamp: 1,
  });

const reply = (
  id: number,
  text: string,
  options?: Parameters<typeof fauxAssistantMessage>[1]
) =>
  entry(
    id,
    AssistantEntry.kind,
    fauxAssistantMessage(text, { timestamp: 2, ...options })
  );

const toolCall = (id: number) =>
  entry(
    id,
    AssistantEntry.kind,
    fauxAssistantMessage(fauxToolCall("get_account", {}, { id: "call-1" }), {
      stopReason: "toolUse",
      timestamp: 2,
    })
  );

const toolResult = (id: number, diagnostics: ToolDiagnostic[] = []) =>
  entry(
    id,
    ToolResultEntry.kind,
    {
      role: "toolResult",
      toolCallId: "call-1",
      toolName: "get_account",
      content: [{ type: "text", text: "cash: TWD 1000" }],
      isError: diagnostics.length > 0,
      timestamp: 3,
    },
    { diagnostics }
  );

test("the thread shows what the user typed, not the app's context", () => {
  expect(
    userText({
      role: "user",
      content: userContent("How is 2330?", "viewing: TW 2330"),
      timestamp: 1,
    })
  ).toBe("How is 2330?");
});

test("a finished conversation replays idle", () => {
  const view = foldEvents(
    transcriptEvents([user(1, "hi"), reply(2, "hello")], false)
  );

  expect(view.running).toBe(false);
  expect(view.items).toMatchObject([
    { kind: "user", messageId: "1", text: "hi" },
    { kind: "assistant", messageId: "2", text: "hello" },
  ]);
});

test("a run that stops short replays as interrupted", () => {
  const view = foldEvents(
    transcriptEvents([user(1, "hi"), toolCall(2)], false)
  );

  expect(view.running).toBe(false);
  expect(view.items).toMatchObject([
    { kind: "user" },
    { kind: "assistant" },
    { kind: "tool", toolCallId: "call-1", status: ToolCallStatus.Aborted },
    { kind: "notice", reason: RunEndReason.Interrupted },
  ]);
});

test("a run still going replays running, with its calls open", () => {
  const view = foldEvents(transcriptEvents([user(1, "hi"), toolCall(2)], true));

  expect(view.running).toBe(true);
  expect(view.items.at(-1)).toMatchObject({
    kind: "tool",
    status: ToolCallStatus.Running,
  });
});

test("a call stopped with its run replays the run as aborted", () => {
  const view = foldEvents(
    transcriptEvents(
      [
        user(1, "hi"),
        toolCall(2),
        toolResult(3, [
          {
            severity: "error",
            code: "aborted",
            message: "Tool get_account was aborted",
          },
        ]),
      ],
      false
    )
  );

  expect(view.items.slice(-2)).toMatchObject([
    { kind: "tool", status: ToolCallStatus.Aborted, error: undefined },
    { kind: "notice", reason: RunEndReason.Aborted },
  ]);
});

test("a failed reply a retry answered replays as done", () => {
  const view = foldEvents(
    transcriptEvents(
      [
        user(1, "hi"),
        reply(2, "", { stopReason: "error", errorMessage: "overloaded" }),
        reply(3, "hello"),
      ],
      false
    )
  );

  expect(view.items.map((item) => item.kind)).toEqual([
    "user",
    "assistant",
    "assistant",
  ]);
});

test("a reply cut short and resumed after a restart replays as one run", () => {
  const view = foldEvents(
    transcriptEvents(
      [
        user(1, "hi"),
        reply(2, "hel", { stopReason: "aborted" }),
        reply(3, "hello"),
        user(4, "again"),
      ],
      false
    )
  );

  expect(view.items).toMatchObject([
    { kind: "user", text: "hi" },
    { kind: "assistant", text: "hel" },
    { kind: "assistant", text: "hello" },
    { kind: "user", text: "again" },
    { kind: "notice", reason: RunEndReason.Interrupted },
  ]);
});

test("an interrupted run is closed before the next one starts", () => {
  const view = foldEvents(
    transcriptEvents(
      [user(1, "hi"), user(2, "again"), reply(3, "hello")],
      false
    )
  );

  expect(view.items).toMatchObject([
    { kind: "user", text: "hi" },
    { kind: "notice", reason: RunEndReason.Interrupted },
    { kind: "user", text: "again" },
    { kind: "assistant", text: "hello" },
  ]);
});

test("a question asked before its call's start goes out follows the start", () => {
  const transcriber = createTranscriber({});

  expect(
    transcriber.approval({
      type: AgentEventType.ApprovalRequest,
      toolCallId: "c1",
    })
  ).toEqual([]);
  expect(
    transcriber.toolStart({
      type: AgentEventType.ToolStart,
      toolCallId: "c1",
      toolName: "place_order",
      args: {},
    })
  ).toMatchObject([
    { type: AgentEventType.ToolStart, toolCallId: "c1" },
    { type: AgentEventType.ApprovalRequest, toolCallId: "c1" },
  ]);
  expect(
    transcriber.approval({
      type: AgentEventType.ApprovalResolved,
      toolCallId: "c1",
      approved: true,
    })
  ).toHaveLength(1);
});
