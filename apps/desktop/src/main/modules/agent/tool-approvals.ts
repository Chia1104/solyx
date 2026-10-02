import { AgentEventType } from "@solyx/agent/wire";
import type { AgentWireEvent } from "@solyx/agent/wire";

interface Pending {
  sessionId: string;
  decide: (approved: boolean) => void;
}

/**
 * Calls waiting for the user to allow them. The run waits in memory, so a call left waiting when
 * the app quits ends with the run as interrupted.
 */
export function createToolApprovals(
  onEvent: (sessionId: string, event: AgentWireEvent) => void
) {
  const pending = new Map<string, Pending>();

  return {
    /** Resolves whether the user allowed the call; a withdrawn question counts as refused. */
    request(sessionId: string, toolCallId: string, signal?: AbortSignal) {
      return new Promise<boolean>((resolve) => {
        const decide = (approved: boolean) => {
          pending.delete(toolCallId);
          onEvent(sessionId, {
            type: AgentEventType.ApprovalResolved,
            toolCallId,
            approved,
          });
          resolve(approved);
        };

        pending.set(toolCallId, { sessionId, decide });
        onEvent(sessionId, {
          type: AgentEventType.ApprovalRequest,
          toolCallId,
        });
        signal?.addEventListener("abort", () => decide(false), { once: true });
      });
    },

    decide(sessionId: string, toolCallId: string, approved: boolean) {
      const call = pending.get(toolCallId);

      if (!call || call.sessionId !== sessionId) {
        throw new Error("That call is no longer waiting for an answer");
      }

      call.decide(approved);
    },

    /** Requests still open in a conversation, so a renderer that reloads shows them again. */
    open(sessionId: string): AgentWireEvent[] {
      return [...pending]
        .filter(([, call]) => call.sessionId === sessionId)
        .map(([toolCallId]) => ({
          type: AgentEventType.ApprovalRequest,
          toolCallId,
        }));
    },
  };
}
