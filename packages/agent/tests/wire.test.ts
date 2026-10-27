import { expect, test } from "vite-plus/test";

import {
  AgentCommand,
  AgentEventType,
  RunEndReason,
  ToolCallStatus,
  MessagePartKind,
  foldEvents,
  messageCommand,
  messageParts,
  messageTokens,
} from "../src/wire.ts";
import type { AgentWireEvent } from "../src/wire.ts";

const call: AgentWireEvent[] = [
  { type: AgentEventType.RunStart },
  {
    type: AgentEventType.ToolStart,
    toolCallId: "c1",
    toolName: "mcp_news_search",
    args: { q: "TSMC" },
  },
  { type: AgentEventType.ApprovalRequest, toolCallId: "c1" },
];

test("a call waits for the user, then runs once allowed", () => {
  expect(foldEvents(call).items[0]).toMatchObject({
    status: ToolCallStatus.AwaitingApproval,
  });

  expect(
    foldEvents([
      ...call,
      {
        type: AgentEventType.ApprovalResolved,
        toolCallId: "c1",
        approved: true,
      },
    ]).items[0]
  ).toMatchObject({ status: ToolCallStatus.Running });
});

test("a run that ends while a call waits leaves the call stopped", () => {
  const view = foldEvents([
    ...call,
    { type: AgentEventType.RunEnd, reason: RunEndReason.Aborted },
  ]);

  expect(view.items[0]).toMatchObject({ status: ToolCallStatus.Aborted });
  expect(view.running).toBe(false);
});

test("a call shows as the reply writes it, then runs where it was drafted", () => {
  const drafted: AgentWireEvent[] = [
    { type: AgentEventType.RunStart },
    { type: AgentEventType.AssistantStart, messageId: "m1" },
    {
      type: AgentEventType.ToolDraft,
      toolCallId: "c1",
      toolName: "revise_report",
    },
  ];

  expect(foldEvents(drafted).items[1]).toMatchObject({
    toolCallId: "c1",
    status: ToolCallStatus.Drafting,
  });

  const started = foldEvents([
    ...drafted,
    {
      type: AgentEventType.AssistantEnd,
      messageId: "m1",
      text: "",
      at: 1,
    },
    {
      type: AgentEventType.ToolStart,
      toolCallId: "c1",
      toolName: "revise_report",
      args: { symbol: "2330" },
    },
  ]);

  expect(started.items).toHaveLength(2);
  expect(started.items[1]).toMatchObject({
    toolCallId: "c1",
    status: ToolCallStatus.Running,
    args: { symbol: "2330" },
  });
});

test("a call drafted by a reply that was given up goes when the next reply starts", () => {
  const view = foldEvents([
    { type: AgentEventType.RunStart },
    { type: AgentEventType.AssistantStart, messageId: "m1" },
    { type: AgentEventType.ToolDraft, toolCallId: "c1", toolName: "bash" },
    { type: AgentEventType.AssistantStart, messageId: "m2" },
  ]);

  expect(view.items).toMatchObject([
    { kind: "assistant", messageId: "m1" },
    { kind: "assistant", messageId: "m2" },
  ]);
});

test("a run that ends while a call is drafted leaves the call stopped", () => {
  const view = foldEvents([
    { type: AgentEventType.RunStart },
    { type: AgentEventType.AssistantStart, messageId: "m1" },
    { type: AgentEventType.ToolDraft, toolCallId: "c1", toolName: "bash" },
    { type: AgentEventType.RunEnd, reason: RunEndReason.Aborted },
  ]);

  expect(view.items[1]).toMatchObject({ status: ToolCallStatus.Aborted });
});

test("a script's calls sit under it, after those it made before, while its round runs on", () => {
  const start = (toolCallId: string, parentToolCallId?: string) => ({
    type: AgentEventType.ToolStart,
    toolCallId,
    toolName: "tool",
    args: {},
    parentToolCallId,
  });

  const view = foldEvents([
    { type: AgentEventType.RunStart },
    start("script"),
    start("other"),
    start("script/1", "script"),
    start("script/2", "script"),
  ]);

  expect(view.items).toMatchObject([
    { toolCallId: "script" },
    { toolCallId: "script/1", parentToolCallId: "script" },
    { toolCallId: "script/2", parentToolCallId: "script" },
    { toolCallId: "other" },
  ]);
});

test("a message names the skill it opens with and each code after @, once", () => {
  expect(
    messageTokens(
      "/deep-analysis 比較@2330和 @2454，再看 ＠nvda、@2330 與 @BRK.B."
    )
  ).toEqual({
    skill: "deep-analysis",
    codes: ["2330", "2454", "NVDA", "BRK.B"],
  });
});

test("an address, a slash inside the text and a bare @ name nothing", () => {
  expect(messageTokens("寄到 me@example.com，看 a/b 的 @ 號")).toEqual({
    skill: undefined,
    codes: [],
  });
  expect(messageTokens("/deep-analysis/x")).toEqual({
    skill: undefined,
    codes: [],
  });
});

test("a message is cut into its text, the skill it opens with and the codes it names", () => {
  expect(messageParts(" /deep-analysis 比較@2330和 ＠nvda.")).toEqual([
    { kind: MessagePartKind.Text, text: " " },
    {
      kind: MessagePartKind.Skill,
      text: "/deep-analysis",
      name: "deep-analysis",
    },
    { kind: MessagePartKind.Text, text: " 比較" },
    { kind: MessagePartKind.Listing, text: "@2330", code: "2330" },
    { kind: MessagePartKind.Text, text: "和 " },
    { kind: MessagePartKind.Listing, text: "＠nvda", code: "NVDA" },
    { kind: MessagePartKind.Text, text: "." },
  ]);
  expect(messageParts("no tokens")).toEqual([
    { kind: MessagePartKind.Text, text: "no tokens" },
  ]);
});

test("a leading /compact is the app's command rather than a skill, and what follows guides it", () => {
  expect(messageParts("/compact keep 2330")).toEqual([
    {
      kind: MessagePartKind.Command,
      text: "/compact",
      name: AgentCommand.Compact,
    },
    { kind: MessagePartKind.Text, text: " keep 2330" },
  ]);
  expect(messageTokens("/compact").skill).toBeUndefined();
  expect(messageCommand("/compact keep @2330 ")).toEqual({
    command: AgentCommand.Compact,
    rest: "keep @2330",
  });
  expect(messageCommand("/compacted")).toBeUndefined();
  expect(messageCommand("compact")).toBeUndefined();
});
