import type { QueryClient } from "@tanstack/react-query";

import { client, forEachEvent, orpc } from "../../app/rpc.ts";

// A strategy's files change by hand with no word to the app, so the list is read again as the
// window comes back to it.
export const strategiesQuery = () =>
  orpc.strategies.list.queryOptions({
    staleTime: 0,
    refetchOnWindowFocus: true,
  });

export const strategyReviewQuery = (name: string) =>
  orpc.strategies.review.queryOptions({ input: name, staleTime: 0 });

/** Reads the strategies again whenever a version is allowed or taken back, by any window or the agent. */
export function followStrategyChanges(queryClient: QueryClient) {
  void forEachEvent(client.strategies.changes(), () => {
    void queryClient.invalidateQueries({ queryKey: orpc.strategies.key() });
  });
}
