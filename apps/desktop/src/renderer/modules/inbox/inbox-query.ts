import { queryOptions } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";

export const inboxQueryKeys = {
  all: ["inbox"] as const,
};

/** Never stale: the main process says when what waits changes, an exchange's day turning among it. */
export const inboxQuery = () =>
  queryOptions({
    queryKey: inboxQueryKeys.all,
    queryFn: () => window.solyx.inbox.list(),
    staleTime: Infinity,
  });

/** Refetches what waits whenever a proposal, a call waiting, research or the listings followed change. */
export function followInboxChanges(queryClient: QueryClient) {
  window.solyx.inbox.onChanged(() => {
    void queryClient.invalidateQueries({ queryKey: inboxQueryKeys.all });
  });
}
