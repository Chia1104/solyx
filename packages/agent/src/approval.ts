import type { Context } from "@earendil-works/chord";
import { defineDoc } from "@earendil-works/pi-durable";
import type {
  ToolExecutionApi,
  ToolRegistration,
} from "@earendil-works/pi-durable";
import * as z from "zod";

import { AgentEventType, ApprovalMode, approvalModeSchema } from "./wire.ts";
import type { AgentWireEvent } from "./wire.ts";

const answersSchema = z.record(z.string(), z.boolean().nullable());

/** What became of a conversation's calls that must ask, by tool call id. */
export interface ApprovalRecord {
  /** What the user answered: `null` while the question is open or was withdrawn with its run. */
  answers: Readonly<Record<string, boolean | null>>;
  /** Calls the decisions model let run unasked, in a conversation set to auto. */
  auto: readonly string[];
}

/** A conversation's approval mode, and what became of its calls that must ask. */
export const ApprovalDoc = defineDoc<{
  mode: ApprovalMode;
  answers: Record<string, boolean | null>;
  auto: string[];
}>({
  kind: "solyx.approvals",
  version: 3,
  scope: "conversation",
  history: "latest",
  fork: "initial",
  initial: () => ({ mode: ApprovalMode.Ask, answers: {}, auto: [] }),
  // Version 1 held only the answers, and version 2 added the mode.
  migrate: (value) => ({
    mode: approvalModeSchema.catch(ApprovalMode.Ask).parse(value.mode),
    answers: answersSchema.parse(value.answers),
    auto: [],
  }),
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

/** A tool call's arguments, as pi-durable hands them to the tool. */
type ToolArguments = Parameters<ToolRegistration["execute"]>[0];

/**
 * Whether a call may run unasked in a conversation set to auto. A tool guarded without one always
 * asks there.
 */
export type AutoCheck = (
  args: ToolArguments,
  api: ToolExecutionApi,
  context: Context
) => Promise<boolean>;

/** Makes every call of a tool wait for the user to allow it, unless its conversation's mode lets it run. */
export type ToolGuard = (
  tool: ToolRegistration,
  auto?: AutoCheck
) => ToolRegistration;

/** What a transcript shows after a call's start: its question and answer, or that the model let it run. */
export function approvalEvents(
  record: ApprovalRecord,
  toolCallId: string
): ApprovalEvent[] {
  if (record.auto.includes(toolCallId)) {
    return [
      {
        type: AgentEventType.ApprovalResolved,
        toolCallId,
        approved: true,
        auto: true,
      },
    ];
  }

  const answer = record.answers[toolCallId];

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
 * Holds the calls of guarded tools until the user answers, unless their conversation's mode lets
 * them run unasked. Each question, its answer and each call the model let run are stored in the
 * conversation before `tell` sends them, so a transcript read from storage shows them too.
 */
export function createApprovalGate(
  tell: (sessionId: string, event: ApprovalEvent) => void
) {
  /** Calls waiting for the user's answer, by tool call id. */
  const waiting = new Map<
    string,
    { sessionId: string; settle: (approved: boolean | undefined) => void }
  >();

  async function ask(
    args: ToolArguments,
    auto: AutoCheck | undefined,
    api: ToolExecutionApi,
    context: Context
  ) {
    const sessionId = String(api.conversationId);
    const toolCallId = api.callId;
    const signal = context.abortSignal;

    const mode = await api.commit(
      async (tx) => (await tx.doc(ApprovalDoc, api.conversationId)).mode,
      context
    );

    if (mode === ApprovalMode.Bypass) return true;

    if (mode === ApprovalMode.Auto && auto) {
      let harmless = false;

      try {
        harmless = await auto(args, api, context);
      } catch {
        // A judgement that fails is no judgement, so the user is asked.
      }

      if (harmless) {
        await api.commit(async (tx) => {
          const approvals = await tx.doc(ApprovalDoc, api.conversationId);

          approvals.auto = [...approvals.auto, toolCallId];
        }, context);
        tell(sessionId, {
          type: AgentEventType.ApprovalResolved,
          toolCallId,
          approved: true,
          auto: true,
        });

        return true;
      }
    }

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
    guard: (tool: ToolRegistration, auto?: AutoCheck): ToolRegistration => ({
      ...tool,
      async execute(params, api, context) {
        if (!(await ask(params, auto, api, context))) {
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
