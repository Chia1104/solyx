import { queryOptions } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";

export const watchlistQueryKeys = {
  all: ["watchlist"] as const,
};

export const watchlistQuery = () =>
  queryOptions({
    queryKey: watchlistQueryKeys.all,
    queryFn: () => window.solyx.watchlist.list(),
  });

/** Refetches the watchlist whenever a listing is added, removed or moved, by any window or the agent. */
export function followWatchlistChanges(queryClient: QueryClient) {
  window.solyx.watchlist.onChanged(() => {
    void queryClient.invalidateQueries({ queryKey: watchlistQueryKeys.all });
  });
}
