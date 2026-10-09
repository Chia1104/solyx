import { queryOptions } from "@tanstack/react-query";

import { symbolKey } from "@solyx/core/market";
import type { Market, SymbolRef } from "@solyx/core/market";

const all = ["flows"] as const;

export const flowsQueryKeys = {
  all,
  listing: (symbol: SymbolRef) =>
    [...all, "listing", symbolKey(symbol)] as const,
  market: (market: Market) => [...all, "market", market] as const,
};

/** Goes stale on its own, since nothing pushes when a session's figures come out. */
export const listingFlowsQuery = (symbol: SymbolRef) =>
  queryOptions({
    queryKey: flowsQueryKeys.listing(symbol),
    queryFn: () => window.solyx.flows.listing(symbol),
  });

export const marketFlowsQuery = (market: Market) =>
  queryOptions({
    queryKey: flowsQueryKeys.market(market),
    queryFn: () => window.solyx.flows.market(market),
  });
