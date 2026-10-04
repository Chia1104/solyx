import { useEffect } from "react";

import { useQueryClient } from "@tanstack/react-query";
import { groupBy } from "es-toolkit";

import { AgentEventType, applyEvent } from "@solyx/agent/wire";
import type { AgentView } from "@solyx/agent/wire";

import type { AgentUpdate } from "#shared/ipc/agent.ts";

import { agentQueryKeys } from "./agent-query.ts";

/**
 * Folds the main process's agent events into each open conversation's cached view. Deltas
 * arrive many times a second, so events are applied once per frame.
 */
export function useAgentEvents() {
  const queryClient = useQueryClient();

  useEffect(() => {
    let pending: AgentUpdate[] = [];
    let frame: number | undefined;

    function flush() {
      frame = undefined;

      const updates = pending;

      pending = [];

      for (const [sessionId, batch] of Object.entries(
        groupBy(updates, (update) => update.sessionId)
      )) {
        // A conversation nobody has open is fetched whole when it is opened.
        queryClient.setQueryData<AgentView>(
          agentQueryKeys.transcript(sessionId),
          (view) =>
            view &&
            batch.reduce((next, update) => applyEvent(next, update.event), view)
        );

        const events = batch.map((update) => update.event);

        // A run renames and reorders conversations as it starts.
        if (events.some((event) => event.type === AgentEventType.RunStart)) {
          void queryClient.invalidateQueries({
            queryKey: agentQueryKeys.sessions,
          });
        }
      }
    }

    const stop = window.solyx.agent.onEvent((update) => {
      pending.push(update);
      frame ??= requestAnimationFrame(flush);
    });

    return () => {
      stop();

      if (frame !== undefined) cancelAnimationFrame(frame);
    };
  }, [queryClient]);
}
