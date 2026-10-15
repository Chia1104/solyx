import type { QueryClient } from "@tanstack/react-query";

import { client, forEachEvent, orpc } from "../../app/rpc.ts";

/** Never stale: the main process says whenever a check or download moves on. */
export const updateStateQuery = () =>
  orpc.updates.state.queryOptions({ staleTime: Infinity });

/** Refetches the update state whenever it changes, whether a scheduled check or the user started it. */
export function followUpdateChanges(queryClient: QueryClient) {
  void forEachEvent(client.updates.changes(), () => {
    void queryClient.invalidateQueries({ queryKey: orpc.updates.key() });
  });
}
