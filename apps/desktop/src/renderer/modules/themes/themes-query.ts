import { queryOptions } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";

export const themesQueryKeys = {
  all: ["themes"] as const,
};

/** Never stale: the main process says when a theme, or what was found for one, changes. */
export const themesQuery = () =>
  queryOptions({
    queryKey: themesQueryKeys.all,
    queryFn: () => window.solyx.themes.list(),
    staleTime: Infinity,
  });

/** Refetches the themes whenever one is written or removed, by the user or the agent, or a search finds something. */
export function followThemeChanges(queryClient: QueryClient) {
  window.solyx.themes.onChanged(() => {
    void queryClient.invalidateQueries({ queryKey: themesQueryKeys.all });
  });
}
