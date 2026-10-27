import { expect, test } from "vite-plus/test";

import { AgentItemKind, ToolCallStatus } from "@solyx/agent/wire";
import type {
  AgentViewItem,
  MessageView,
  ToolCallView,
} from "@solyx/agent/wire";

import {
  StepKind,
  WorkKind,
  currentStep,
  stepCount,
  threadTurns,
  turnSeconds,
} from "../src/modules/agent/agent-turns.ts";

const user = (messageId: string, at = 0): MessageView => ({
  kind: AgentItemKind.User,
  messageId,
  text: "How is 2330?",
  at,
  streaming: false,
});

const reply = (
  messageId: string,
  fields: Partial<MessageView> = {}
): MessageView => ({
  kind: AgentItemKind.Assistant,
  messageId,
  text: "",
  streaming: false,
  ...fields,
});

const call = (
  toolCallId: string,
  fields: Partial<ToolCallView> = {}
): ToolCallView => ({
  kind: AgentItemKind.Tool,
  toolCallId,
  toolName: "get_candles",
  args: {},
  status: ToolCallStatus.Ok,
  ...fields,
});

test("the work folds away and the last reply stands as the answer", () => {
  const [turn] = threadTurns([
    user("u1", 1_000),
    reply("m1", { thinking: "Read the bars.", text: "Reading the bars." }),
    call("c1"),
    reply("m2", { thinking: "It rose.", text: "2330 rose 2%.", at: 13_000 }),
  ]);

  expect(turn?.work.map((work) => work.kind)).toEqual([
    WorkKind.Thinking,
    WorkKind.Text,
    WorkKind.Tool,
    WorkKind.Thinking,
  ]);
  expect(turn?.answer?.messageId).toBe("m2");
  expect(turn && turnSeconds(turn)).toBe(12);
});

test("a reply a call followed is work, so the turn has no answer yet", () => {
  const [turn] = threadTurns([
    user("u1"),
    reply("m1", { text: "Let me write the report." }),
    call("c1", { toolName: "revise_report", status: ToolCallStatus.Drafting }),
  ]);

  expect(turn?.answer).toBeUndefined();
  expect(turn && currentStep(turn)).toMatchObject({
    kind: StepKind.Tool,
    tool: { toolCallId: "c1" },
  });
});

test("a call that waits on the user or made a proposal stays in view", () => {
  const [turn] = threadTurns([
    user("u1"),
    call("c1", { toolName: "bash", status: ToolCallStatus.AwaitingApproval }),
    call("c2", {
      toolName: "propose_order",
      details: { proposalId: "p1" },
    }),
    call("c3"),
  ]);

  expect(turn?.cards.map((tool) => tool.toolCallId)).toEqual(["c1", "c2"]);
  expect(turn?.work).toHaveLength(1);
});

test("the step a turn is on: a waiting call first, else what the reply streams", () => {
  const step = (items: AgentViewItem[]) => {
    const [turn] = threadTurns([user("u1"), ...items]);

    return turn ? currentStep(turn) : undefined;
  };

  expect(
    step([
      reply("m1"),
      call("c1", { status: ToolCallStatus.Running }),
      call("c2", { status: ToolCallStatus.AwaitingApproval }),
    ])
  ).toMatchObject({ kind: StepKind.Tool, tool: { toolCallId: "c2" } });

  expect(
    step([reply("m1", { streaming: true, thinking: "Hmm" })])
  ).toMatchObject({ kind: StepKind.Thinking });

  expect(step([reply("m1", { streaming: true, text: "2330" })])).toMatchObject({
    kind: StepKind.Answering,
  });

  // A call ended and the next request is out.
  expect(step([reply("m1"), call("c1")])).toMatchObject({
    kind: StepKind.Working,
  });
});

test("a turn the next items left alone keeps its object", () => {
  const first = [user("u1"), call("c1"), reply("m1", { text: "Done." })];
  const before = threadTurns(first);
  const after = threadTurns([...first, user("u2"), call("c2")], before);

  expect(after[0]).toBe(before[0]);
  expect(after).toHaveLength(2);
});

test("a script's calls are not steps of their own", () => {
  const [turn] = threadTurns([
    user("u1"),
    call("script", { toolName: "codemode" }),
    call("script/1", { parentToolCallId: "script" }),
  ]);

  expect(turn && stepCount(turn)).toBe(1);
});
