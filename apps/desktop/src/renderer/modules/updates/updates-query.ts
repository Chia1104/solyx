import { queryOptions } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";

export const updatesQueryKeys = {
  all: ["updates"] as const,
};

/** Never stale: the main process says whenever a check or download moves on. */
export const updateStateQuery = () =>
  queryOptions({
    queryKey: updatesQueryKeys.all,
    queryFn: () => window.solyx.updates.state(),
    staleTime: Infinity,
  });

/** Refetches the update state whenever it changes, whether a scheduled check or the user started it. */
export function followUpdateChanges(queryClient: QueryClient) {
  window.solyx.updates.onChanged(() => {
    void queryClient.invalidateQueries({ queryKey: updatesQueryKeys.all });
  });
}
