import { queryOptions } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";

import { settingsQueryKeys } from "../settings/settings-query.ts";

const all = ["market"] as const;

export const marketQueryKeys = {
  all,
  sessions: [...all, "sessions"] as const,
};

/** Never stale on its own, since `followQuotes` polls it for every reader. */
export const marketSessionsQuery = () =>
  queryOptions({
    queryKey: marketQueryKeys.sessions,
    queryFn: () => window.solyx.market.sessions(),
    staleTime: Infinity,
  });

/** Loads bars, names and the sources' state again whenever the main process says the sources changed. */
export function followMarketDataChanges(queryClient: QueryClient) {
  window.solyx.market.onSourcesChanged(() => {
    void queryClient.invalidateQueries({ queryKey: marketQueryKeys.all });
    void queryClient.invalidateQueries({
      queryKey: settingsQueryKeys.marketData,
    });
  });
}
