import type { QueryClient } from "@tanstack/react-query";

import { client, orpc } from "../../app/rpc.ts";

/** Never stale: the main process says when what waits changes, an exchange's day turning among it. */
export const inboxQuery = () =>
  orpc.inbox.list.queryOptions({ staleTime: Infinity });

/** Refetches what waits whenever a proposal, a call waiting, research or the listings followed change. */
export async function followInboxChanges(queryClient: QueryClient) {
  for await (const _change of await client.inbox.changes()) {
    void queryClient.invalidateQueries({ queryKey: orpc.inbox.key() });
  }
}
