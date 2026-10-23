import type { QueryClient } from "@tanstack/react-query";
import { groupBy } from "es-toolkit";

import { AgentEventType, applyEvent } from "@solyx/agent/wire";
import type { AgentView } from "@solyx/agent/wire";
import type { AgentUpdate } from "@solyx/api/agent";

import { client, forEachEvent, orpc } from "../../app/rpc.ts";

import { agentQueryKeys } from "./agent-query.ts";

/**
 * Folds the main process's agent events into each open conversation's cached view, and reads
 * again whether the store failed once it says so. Deltas arrive many times a second, so events
 * are applied once per frame, and this is the window's one stream of them.
 */
export function followAgentEvents(queryClient: QueryClient) {
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
          queryKey: orpc.agent.sessions.key(),
        });
      }

      // A run ending frees the scheduled task that started it.
      if (events.some((event) => event.type === AgentEventType.RunEnd)) {
        void queryClient.invalidateQueries({
          queryKey: orpc.schedules.list.key(),
        });
      }
    }
  }

  void forEachEvent(client.agent.events(), (update) => {
    pending.push(update);
    frame ??= requestAnimationFrame(flush);
  });

  void forEachEvent(
    client.agent.storeFailures(),
    () =>
      void queryClient.invalidateQueries({
        queryKey: orpc.agent.storeFailed.key(),
      })
  );
}
