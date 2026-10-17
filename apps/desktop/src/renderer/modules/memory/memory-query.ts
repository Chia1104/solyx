import type { QueryClient } from "@tanstack/react-query";

import { client, forEachEvent, orpc } from "../../app/rpc.ts";

/** Never stale: the main process says when any memory changes. */
export const memoryQuery = () =>
  orpc.memory.list.queryOptions({ staleTime: Infinity });

/** Refetches the memories whenever one changes: by the agent, in any window or by clearing them. */
export function followMemoryChanges(queryClient: QueryClient) {
  void forEachEvent(client.memory.changes(), () => {
    void queryClient.invalidateQueries({ queryKey: orpc.memory.key() });
  });
}
