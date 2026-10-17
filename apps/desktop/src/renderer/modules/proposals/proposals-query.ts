import type { QueryClient } from "@tanstack/react-query";

import { client, forEachEvent, orpc } from "../../app/rpc.ts";

/** Never stale: the main process says when any proposal changes. */
export const proposalsQuery = () =>
  orpc.proposals.list.queryOptions({ staleTime: Infinity });

/** Refetches the proposals and the account whenever a proposal changes, in any window or by the agent. */
export function followProposalChanges(queryClient: QueryClient) {
  void forEachEvent(client.proposals.changes(), () => {
    void queryClient.invalidateQueries({ queryKey: orpc.proposals.key() });
    void queryClient.invalidateQueries({ queryKey: orpc.account.key() });
  });
}
