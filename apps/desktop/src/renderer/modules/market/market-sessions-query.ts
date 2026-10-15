import type { QueryClient } from "@tanstack/react-query";

import { client, forEachEvent, orpc } from "../../app/rpc.ts";

/** Never stale on its own, since `followQuotes` polls it for every reader. */
export const marketSessionsQuery = () =>
  orpc.market.sessions.queryOptions({ staleTime: Infinity });

/** Loads bars, names and the sources' state again whenever the main process says the sources changed. */
export function followMarketDataChanges(queryClient: QueryClient) {
  void forEachEvent(client.market.sourceChanges(), () => {
    void queryClient.invalidateQueries({ queryKey: orpc.market.key() });
    void queryClient.invalidateQueries({
      queryKey: orpc.settings.marketData.key(),
    });
  });
}
