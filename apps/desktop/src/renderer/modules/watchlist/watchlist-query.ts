import type { QueryClient } from "@tanstack/react-query";

import { client, forEachEvent, orpc } from "../../app/rpc.ts";

export const watchlistQuery = () => orpc.watchlist.list.queryOptions();

/** Refetches the watchlist whenever a listing is added, removed or moved, by any window or the agent. */
export function followWatchlistChanges(queryClient: QueryClient) {
  void forEachEvent(client.watchlist.changes(), () => {
    void queryClient.invalidateQueries({ queryKey: orpc.watchlist.key() });
  });
}
