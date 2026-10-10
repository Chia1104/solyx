import { AgentEventType } from "@solyx/agent/wire";
import type { AgentWireEvent } from "@solyx/agent/wire";

/**
 * The calls waiting for the user to allow them, by conversation, as the runs' events tell of them.
 * A question lives only as long as its run, so nothing waits that no event here told of.
 */
export function createWaitingCalls() {
  const calls = new Map<string, Set<string>>();

  return {
    /** Takes one event in, and says whether a run started or ended or a call began or stopped waiting. */
    follow(sessionId: string, event: AgentWireEvent): boolean {
      switch (event.type) {
        case AgentEventType.RunStart:
          return true;
        case AgentEventType.ApprovalRequest: {
          const waiting = calls.get(sessionId) ?? new Set();

          waiting.add(event.toolCallId);
          calls.set(sessionId, waiting);

          return true;
        }

        case AgentEventType.ApprovalResolved: {
          const waiting = calls.get(sessionId);

          waiting?.delete(event.toolCallId);

          if (waiting?.size === 0) calls.delete(sessionId);

          return true;
        }

        // A question still open is withdrawn with its run.
        case AgentEventType.RunEnd:
          calls.delete(sessionId);

          return true;
        default:
          return false;
      }
    },

    /** Drops what a conversation since deleted was asked. */
    forget(sessionId: string) {
      calls.delete(sessionId);
    },

    /** The conversations with a call waiting. */
    sessions: (): string[] => [...calls.keys()],
  };
}
