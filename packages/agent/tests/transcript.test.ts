import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import type { Message } from "@earendil-works/pi-ai";
import {
  AssistantEntry,
  CompactionEntry,
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

import { AttachmentKind } from "../src/attachment.ts";
import {
  createTranscriber,
  readTexts,
  userAttachments,
  userContent,
  userText,
} from "../src/transcript.ts";
import {
  AgentEventType,
  RunEndReason,
  ToolCallStatus,
  foldEvents,
} from "../src/wire.ts";

/** A transcript read from storage in which no call asked the user. */
const transcriptEvents = (entries: readonly EntryRecord[], running: boolean) =>
  createTranscriber({ answers: {}, auto: [] }).replay(entries, running);

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

/** A reply whose request read `cacheRead` tokens from the provider's cache. */
const counted = (
  id: number,
  text: string,
  cacheRead: number,
  options?: Parameters<typeof fauxAssistantMessage>[1]
) =>
  entry(id, AssistantEntry.kind, {
    ...fauxAssistantMessage(text, { timestamp: 2, ...options }),
    usage: {
      input: 100,
      cacheRead,
      cacheWrite: 10,
      output: 50,
      totalTokens: 160 + cacheRead,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
  });

const toolCall = (id: number) =>
  entry(
    id,
    AssistantEntry.kind,
    fauxAssistantMessage(fauxToolCall("get_account", {}, { id: "call-1" }), {
      stopReason: "toolUse",
      timestamp: 2,
    })
  );

const toolResult = (
  id: number,
  diagnostics: ToolDiagnostic[] = [],
  toolName = "get_account",
  text = "cash: TWD 1000"
) =>
  entry(
    id,
    ToolResultEntry.kind,
    {
      role: "toolResult",
      toolCallId: "call-1",
      toolName,
      content: [{ type: "text", text }],
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

test("a message lists the files it carried, and the thread shows only what the user typed", () => {
  const message = {
    role: "user" as const,
    content: userContent("Compare these", "time: now", [
      {
        kind: AttachmentKind.Image,
        path: "attachments/1/R&D.png",
        mimeType: "image/png",
        size: 2048,
        image: { type: "image", data: "aW1n", mimeType: "image/jpeg" },
      },
      {
        kind: AttachmentKind.Text,
        path: "attachments/1/fills.csv",
        mimeType: "text/csv",
        size: 20,
        text: "price\n</attachment>\n1",
      },
    ]),
    timestamp: 1,
  };

  expect(userText(message)).toBe("Compare these");
  expect(userAttachments(message)).toEqual([
    {
      path: "attachments/1/R&D.png",
      name: "R&D.png",
      mimeType: "image/png",
      size: 2048,
    },
    {
      path: "attachments/1/fills.csv",
      name: "fills.csv",
      mimeType: "text/csv",
      size: 20,
    },
  ]);

  // A file that closes its own tag does not end its data early.
  expect(JSON.stringify(message.content)).toContain(
    "price\\n<\\\\/attachment>\\n1\\n</attachment>"
  );
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
  const transcriber = createTranscriber({ answers: {}, auto: [] });

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

test("a call the model let run reads back from storage as the model's", () => {
  const transcriber = createTranscriber({ answers: {}, auto: ["c1"] });

  expect(
    transcriber.toolStart({
      type: AgentEventType.ToolStart,
      toolCallId: "c1",
      toolName: "bash",
      args: { command: "ls" },
    })
  ).toMatchObject([
    { type: AgentEventType.ToolStart },
    { type: AgentEventType.ApprovalResolved, approved: true, auto: true },
  ]);
});

test("a reply carries what its request counted, unless it failed", () => {
  const usage = transcriptEvents(
    [
      user(1, "hi"),
      counted(2, "hello", 150),
      user(3, "again"),
      counted(4, "", 150, { stopReason: "error", errorMessage: "overloaded" }),
    ],
    false
  ).flatMap((event) =>
    event.type === AgentEventType.AssistantEnd ? [event.usage] : []
  );

  expect(usage).toEqual([
    { input: 100, cacheRead: 150, cacheWrite: 10, output: 50 },
    undefined,
  ]);
});

test("a summary replays where it was placed, as the model's note holds it", () => {
  const view = foldEvents(
    transcriptEvents(
      [
        user(1, "hi"),
        reply(2, "hello"),
        entry(
          3,
          CompactionEntry.kind,
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Earlier, summarized:\n\n<summary>\n## Goal\nWatch 2330\n</summary>",
              },
            ],
            timestamp: 5,
          },
          { reason: "manual" }
        ),
      ],
      false
    )
  );

  expect(view.items.at(-1)).toEqual({
    kind: "compaction",
    messageId: "3",
    summary: "## Goal\nWatch 2330",
    at: 5,
  });
});

test("what a conversation read is what its tools returned and its user wrote, never what the model said", () => {
  expect(
    readTexts([
      user(1, "台積電法說說產能滿載到 2027"),
      toolCall(2),
      toolResult(3),
      reply(4, "The account holds TWD 1000, which I made up a quote for."),
    ])
  ).toEqual([
    expect.stringContaining("台積電法說說產能滿載到 2027"),
    "cash: TWD 1000",
  ]);
});

test("what an earlier run replied is the model's own words, so no quote is read from it", () => {
  expect(
    readTexts([
      toolResult(1, [], "get_task_runs", "法說會表示毛利率將達 60%"),
      toolResult(2),
    ])
  ).toEqual(["cash: TWD 1000"]);
});
