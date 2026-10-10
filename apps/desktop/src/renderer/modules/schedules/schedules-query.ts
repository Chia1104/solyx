import { queryOptions } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";

import { AgentEventType } from "@solyx/agent/wire";

import { agentQueryKeys } from "../agent/agent-query.ts";

export const schedulesQueryKeys = {
  all: ["schedules"] as const,
};

/** Never stale: the main process says when a task changes or runs, and the agent when a run ends. */
export const schedulesQuery = () =>
  queryOptions({
    queryKey: schedulesQueryKeys.all,
    queryFn: () => window.solyx.schedules.list(),
    staleTime: Infinity,
  });

/**
 * Refetches the scheduled tasks whenever one is saved, removed or run, and the conversations with
 * them, since a run starts one of its own; and again as any run ends, which frees its task.
 */
export function followScheduleChanges(queryClient: QueryClient) {
  window.solyx.schedules.onChanged(() => {
    void queryClient.invalidateQueries({ queryKey: schedulesQueryKeys.all });
    void queryClient.invalidateQueries({ queryKey: agentQueryKeys.sessions });
  });

  window.solyx.agent.onEvent(({ event }) => {
    if (event.type === AgentEventType.RunEnd) {
      void queryClient.invalidateQueries({ queryKey: schedulesQueryKeys.all });
    }
  });
}
