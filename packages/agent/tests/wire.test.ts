import { expect, test } from "vite-plus/test";

import {
  AgentEventType,
  RunEndReason,
  ToolCallStatus,
  foldEvents,
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
