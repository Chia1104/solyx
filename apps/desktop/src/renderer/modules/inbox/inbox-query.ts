import { queryOptions } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";

import { Market, exchangeDate } from "@solyx/core/market";

/** How often the exchanges' days are looked at, since a report's event passes as one turns. */
const DAY_CHECK_MS = 60 * 1000;

export const inboxQueryKeys = {
  all: ["inbox"] as const,
};

/** Never stale on its own: `followInboxChanges` refreshes it on every push and as an exchange's day turns. */
export const inboxQuery = () =>
  queryOptions({
    queryKey: inboxQueryKeys.all,
    queryFn: () => window.solyx.inbox.list(),
    staleTime: Infinity,
  });

/**
 * Refetches what waits whenever a proposal, a call waiting, research or the listings followed
 * change, and as an exchange's day turns, when a report's event passes, which nothing pushes.
 */
export function followInboxChanges(queryClient: QueryClient) {
  const refresh = () =>
    void queryClient.invalidateQueries({ queryKey: inboxQueryKeys.all });

  window.solyx.inbox.onChanged(refresh);

  const days = () =>
    Object.values(Market)
      .map((market) => exchangeDate(market))
      .join(" ");

  let seen = days();

  setInterval(() => {
    const today = days();

    if (today === seen) return;

    seen = today;
    refresh();
  }, DAY_CHECK_MS);
}
