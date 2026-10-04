import type { Context } from "@earendil-works/chord";
import { defineDoc } from "@earendil-works/pi-durable";
import type {
  ToolExecutionApi,
  ToolRegistration,
} from "@earendil-works/pi-durable";

import { AgentEventType } from "./wire.ts";
import type { AgentWireEvent } from "./wire.ts";

/**
 * What the user answered each call that asked, by tool call id: `null` while the question is open
 * or was withdrawn with its run.
 */
export type ApprovalAnswers = Readonly<Record<string, boolean | null>>;

export const ApprovalDoc = defineDoc<{
  answers: Record<string, boolean | null>;
}>({
  kind: "solyx.approvals",
  version: 1,
  scope: "conversation",
  history: "latest",
  fork: "initial",
  initial: () => ({ answers: {} }),
});

/** What a guarded call tells its conversation: that it asks, then what the user answered. */
export type ApprovalEvent = Extract<
  AgentWireEvent,
  {
    type:
      | typeof AgentEventType.ApprovalRequest
      | typeof AgentEventType.ApprovalResolved;
  }
>;

/** Makes every call of a tool wait for the user to allow it. */
export type ToolGuard = (tool: ToolRegistration) => ToolRegistration;

/** The question a call asked and its answer, which follow the call's start in a transcript. */
export function approvalEvents(
  answers: ApprovalAnswers,
  toolCallId: string
): ApprovalEvent[] {
  const answer = answers[toolCallId];

  if (answer === undefined) return [];

  const events: ApprovalEvent[] = [
    { type: AgentEventType.ApprovalRequest, toolCallId },
  ];

  if (answer !== null) {
    events.push({
      type: AgentEventType.ApprovalResolved,
      toolCallId,
      approved: answer,
    });
  }

  return events;
}

/**
 * Holds the calls of guarded tools until the user answers. Each question and its answer are stored
 * in the conversation before `tell` sends them, so a transcript read from storage shows them too.
 */
export function createApprovalGate(
  tell: (sessionId: string, event: ApprovalEvent) => void
) {
  /** Calls waiting for the user's answer, by tool call id. */
  const waiting = new Map<
    string,
    { sessionId: string; settle: (approved: boolean | undefined) => void }
  >();

  async function ask(api: ToolExecutionApi, context: Context) {
    const sessionId = String(api.conversationId);
    const toolCallId = api.callId;
    const signal = context.abortSignal;

    const store = (answer: boolean | null) =>
      api.commit(async (tx) => {
        const approvals = await tx.doc(ApprovalDoc, api.conversationId);

        approvals.answers = { ...approvals.answers, [toolCallId]: answer };
      }, context);

    await store(null);
    tell(sessionId, { type: AgentEventType.ApprovalRequest, toolCallId });

    const approved = await new Promise<boolean | undefined>((resolve) => {
      const settle = (answer: boolean | undefined) => {
        if (waiting.delete(toolCallId)) resolve(answer);
      };

      waiting.set(toolCallId, { sessionId, settle });

      if (signal?.aborted) settle(undefined);
      else {
        signal?.addEventListener("abort", () => settle(undefined), {
          once: true,
        });
      }
    });

    // A question withdrawn with its run stays unanswered, and its call does not run.
    if (approved === undefined) return false;

    await store(approved);
    tell(sessionId, {
      type: AgentEventType.ApprovalResolved,
      toolCallId,
      approved,
    });

    return approved;
  }

  return {
    guard: (tool: ToolRegistration): ToolRegistration => ({
      ...tool,
      async execute(params, api, context) {
        if (!(await ask(api, context))) {
          throw new Error("The user did not allow this call");
        }

        return tool.execute(params, api, context);
      },
    }),

    /** Answers a call waiting for the user to allow it. */
    approve(sessionId: string, toolCallId: string, approved: boolean) {
      const call = waiting.get(toolCallId);

      if (!call || call.sessionId !== sessionId) {
        throw new Error("That call is no longer waiting for an answer");
      }

      call.settle(approved);
    },
  };
}
