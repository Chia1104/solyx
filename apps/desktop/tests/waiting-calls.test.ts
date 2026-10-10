import { expect, test } from "vite-plus/test";

import { AgentEventType, RunEndReason } from "@solyx/agent/wire";

import { createWaitingCalls } from "../src/main/modules/agent/waiting-calls.ts";

const asks = (toolCallId: string) =>
  ({ type: AgentEventType.ApprovalRequest, toolCallId }) as const;

const answers = (toolCallId: string) =>
  ({
    type: AgentEventType.ApprovalResolved,
    toolCallId,
    approved: true,
  }) as const;

test("a conversation waits until every call it asked about is answered", () => {
  const calls = createWaitingCalls();

  expect(calls.follow("a", { type: AgentEventType.RunStart })).toBe(true);
  expect(calls.sessions()).toEqual([]);

  expect(calls.follow("a", asks("call-1"))).toBe(true);
  calls.follow("a", asks("call-2"));
  calls.follow("b", asks("call-3"));

  expect(calls.sessions()).toEqual(["a", "b"]);

  expect(calls.follow("a", answers("call-1"))).toBe(true);

  expect(calls.sessions()).toEqual(["a", "b"]);

  calls.follow("a", answers("call-2"));

  expect(calls.sessions()).toEqual(["b"]);
});

test("a question still open is withdrawn with its run or its conversation", () => {
  const calls = createWaitingCalls();

  calls.follow("a", asks("call-1"));
  calls.follow("b", asks("call-2"));

  expect(
    calls.follow("a", {
      type: AgentEventType.RunEnd,
      reason: RunEndReason.Aborted,
    })
  ).toBe(true);
  expect(calls.sessions()).toEqual(["b"]);

  calls.forget("b");

  expect(calls.sessions()).toEqual([]);
});

test("what a reply streams changes nothing the tray shows", () => {
  const calls = createWaitingCalls();

  expect(
    calls.follow("a", { type: AgentEventType.Context, tokens: 1200 })
  ).toBe(false);
});
