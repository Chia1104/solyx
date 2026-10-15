import type { QueryClient } from "@tanstack/react-query";

import { client, forEachEvent, orpc } from "../../app/rpc.ts";

/** Never stale: the main process says when a task changes or runs, and the agent when a run ends. */
export const schedulesQuery = () =>
  orpc.schedules.list.queryOptions({ staleTime: Infinity });

/** Never stale: the main process says when a plan changes, and news and themes when something is collected. */
export const collectionsQuery = () =>
  orpc.schedules.collections.queryOptions({ staleTime: Infinity });

/**
 * Refetches the scheduled tasks and the collections' plans whenever one is saved, removed or run,
 * and the conversations with them, since a run starts one of its own; and the collections as news
 * or a theme's search brings something in. A run ending frees its task, which `followAgentEvents`
 * reads again.
 */
export function followScheduleChanges(queryClient: QueryClient) {
  const collected = () =>
    void queryClient.invalidateQueries({
      queryKey: orpc.schedules.collections.key(),
    });

  void forEachEvent(client.schedules.changes(), () => {
    void queryClient.invalidateQueries({ queryKey: orpc.schedules.key() });
    void queryClient.invalidateQueries({
      queryKey: orpc.agent.sessions.key(),
    });
  });

  void forEachEvent(client.news.changes(), collected);
  void forEachEvent(client.themes.changes(), collected);
}
