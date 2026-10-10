import { queryOptions } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";

import { AgentEventType } from "@solyx/agent/wire";

import { agentQueryKeys } from "../agent/agent-query.ts";

const all = ["schedules"] as const;

export const schedulesQueryKeys = {
  all,
  tasks: [...all, "tasks"] as const,
  collections: [...all, "collections"] as const,
};

/** Never stale: the main process says when a task changes or runs, and the agent when a run ends. */
export const schedulesQuery = () =>
  queryOptions({
    queryKey: schedulesQueryKeys.tasks,
    queryFn: () => window.solyx.schedules.list(),
    staleTime: Infinity,
  });

/** Never stale: the main process says when a plan changes, and news and themes when something is collected. */
export const collectionsQuery = () =>
  queryOptions({
    queryKey: schedulesQueryKeys.collections,
    queryFn: () => window.solyx.schedules.collections(),
    staleTime: Infinity,
  });

/**
 * Refetches the scheduled tasks and the collections' plans whenever one is saved, removed or run,
 * and the conversations with them, since a run starts one of its own; the tasks again as any run
 * ends, which frees its task; and the collections as news or a theme's search brings something in.
 */
export function followScheduleChanges(queryClient: QueryClient) {
  const collected = () =>
    void queryClient.invalidateQueries({
      queryKey: schedulesQueryKeys.collections,
    });

  window.solyx.schedules.onChanged(() => {
    void queryClient.invalidateQueries({ queryKey: schedulesQueryKeys.all });
    void queryClient.invalidateQueries({ queryKey: agentQueryKeys.sessions });
  });

  window.solyx.agent.onEvent(({ event }) => {
    if (event.type === AgentEventType.RunEnd) {
      void queryClient.invalidateQueries({
        queryKey: schedulesQueryKeys.tasks,
      });
    }
  });

  window.solyx.news.onChanged(collected);
  window.solyx.themes.onChanged(collected);
}
