import { expect, test, vi } from "vite-plus/test";

import { AgentEventType } from "@solyx/agent/wire";
import type { AgentWireEvent } from "@solyx/agent/wire";

import { createToolApprovals } from "../src/main/modules/agent/tool-approvals.ts";

function setup() {
  const events: [string, AgentWireEvent][] = [];

  const approvals = createToolApprovals((sessionId, event) =>
    events.push([sessionId, event])
  );

  return { approvals, events };
}

test("a call waits until the user answers, and both ends are announced", async () => {
  const { approvals, events } = setup();
  const answer = approvals.request("s1", "c1");

  expect(approvals.open("s1")).toEqual([
    { type: AgentEventType.ApprovalRequest, toolCallId: "c1" },
  ]);
  expect(approvals.open("s2")).toEqual([]);

  approvals.decide("s1", "c1", true);

  await expect(answer).resolves.toBe(true);
  expect(events).toEqual([
    ["s1", { type: AgentEventType.ApprovalRequest, toolCallId: "c1" }],
    [
      "s1",
      {
        type: AgentEventType.ApprovalResolved,
        toolCallId: "c1",
        approved: true,
      },
    ],
  ]);
  expect(approvals.open("s1")).toEqual([]);
});

test("stopping the run withdraws the question as refused", async () => {
  const { approvals } = setup();
  const controller = new AbortController();
  const answer = approvals.request("s1", "c1", controller.signal);

  controller.abort();

  await expect(answer).resolves.toBe(false);
  expect(() => approvals.decide("s1", "c1", true)).toThrow("no longer waiting");
});

test("another conversation cannot answer for this one", () => {
  const { approvals } = setup();
  const answered = vi.fn();

  void approvals.request("s1", "c1").then(answered);

  expect(() => approvals.decide("s2", "c1", true)).toThrow("no longer waiting");
  expect(answered).not.toHaveBeenCalled();
});
