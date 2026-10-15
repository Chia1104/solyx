import type { QueryClient } from "@tanstack/react-query";

import { client, forEachEvent, orpc } from "../../app/rpc.ts";

/** Never stale: the main process says when a theme, or what was found for one, changes. */
export const themesQuery = () =>
  orpc.themes.list.queryOptions({ staleTime: Infinity });

/** Refetches the themes whenever one is written or removed, by the user or the agent, or a search finds something. */
export function followThemeChanges(queryClient: QueryClient) {
  void forEachEvent(client.themes.changes(), () => {
    void queryClient.invalidateQueries({ queryKey: orpc.themes.key() });
  });
}
