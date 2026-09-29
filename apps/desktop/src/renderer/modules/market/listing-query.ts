import { queryOptions } from "@tanstack/react-query";

import type { SymbolRef } from "@solyx/core/market";

import { marketQueryKeys } from "./market-sessions-query.ts";

export const listingQueryKeys = {
  of: (symbol: SymbolRef) =>
    [...marketQueryKeys.all, "listing", symbol.market, symbol.symbol] as const,
};

/** Names rarely change, so each listing is looked up once per session. */
export const listingQuery = (symbol: SymbolRef) =>
  queryOptions({
    queryKey: listingQueryKeys.of(symbol),
    queryFn: () => window.solyx.market.listing(symbol),
    staleTime: Infinity,
  });
