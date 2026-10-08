import { queryOptions } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";

import { accountQueryKeys } from "../account/account-query.ts";

export const proposalsQueryKeys = {
  all: ["proposals"] as const,
};

/** Never stale: the main process says when any proposal changes. */
export const proposalsQuery = () =>
  queryOptions({
    queryKey: proposalsQueryKeys.all,
    queryFn: () => window.solyx.proposals.list(),
    staleTime: Infinity,
  });

/** Refetches the proposals and the account whenever a proposal changes, in any window or by the agent. */
export function followProposalChanges(queryClient: QueryClient) {
  window.solyx.proposals.onChanged(() => {
    void queryClient.invalidateQueries({ queryKey: proposalsQueryKeys.all });
    void queryClient.invalidateQueries({ queryKey: accountQueryKeys.all });
  });
}
