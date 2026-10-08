import { queryOptions } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";

export const memoryQueryKeys = {
  all: ["memory"] as const,
};

/** Never stale: the main process says when any memory changes. */
export const memoryQuery = () =>
  queryOptions({
    queryKey: memoryQueryKeys.all,
    queryFn: () => window.solyx.memory.list(),
    staleTime: Infinity,
  });

/** Refetches the memories whenever one changes: by the agent, in any window or by clearing them. */
export function followMemoryChanges(queryClient: QueryClient) {
  window.solyx.memory.onChanged(() => {
    void queryClient.invalidateQueries({ queryKey: memoryQueryKeys.all });
  });
}
