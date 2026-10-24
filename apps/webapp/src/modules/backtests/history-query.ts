import type { QueryClient } from "@tanstack/react-query";

import { client, forEachEvent, orpc } from "../../app/rpc.ts";

export const historyQuery = () => orpc.backtests.history.queryOptions();

// Comparing runs each setup again, so its answer stands until the user compares again.
export const compareQuery = (ids: string[]) =>
  orpc.backtests.compare.queryOptions({ input: ids, staleTime: Infinity });

/**
 * Reads the history again whenever a run is kept or removed, by any window; the runs' own answers
 * stay, since reading them again would run them again.
 */
export function followBacktestChanges(queryClient: QueryClient) {
  void forEachEvent(client.backtests.changes(), () => {
    void queryClient.invalidateQueries({
      queryKey: orpc.backtests.history.key(),
    });
  });
}
