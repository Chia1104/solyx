import { queryOptions } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";

export const inboxQueryKeys = {
  all: ["inbox"] as const,
};

/** Goes stale on its own too, since a report's event passes as its exchange's day turns, which nothing pushes. */
export const inboxQuery = () =>
  queryOptions({
    queryKey: inboxQueryKeys.all,
    queryFn: () => window.solyx.inbox.list(),
  });

/** Refetches what waits whenever a proposal, a call waiting, research or the listings followed change. */
export function followInboxChanges(queryClient: QueryClient) {
  window.solyx.inbox.onChanged(() => {
    void queryClient.invalidateQueries({ queryKey: inboxQueryKeys.all });
  });
}
