import { queryOptions } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";

import type { SymbolRef } from "@solyx/core/market";

const all = ["research"] as const;

export const researchQueryKeys = {
  all,
  coverage: (symbol: SymbolRef) =>
    [...all, "coverage", symbol.market, symbol.symbol] as const,
};

// A forecast settles as its horizon's session closes, which nothing pushes until it is read.
const SETTLES_WITHIN_MS = 5 * 60 * 1000;

export const researchCoverageQuery = (symbol: SymbolRef) =>
  queryOptions({
    queryKey: researchQueryKeys.coverage(symbol),
    queryFn: () => window.solyx.research.coverage(symbol),
    staleTime: SETTLES_WITHIN_MS,
  });

/** Refetches research whenever the agent revises a report, a forecast is made or settled, or it is cleared. */
export function followResearchChanges(queryClient: QueryClient) {
  window.solyx.research.onChanged(() => {
    void queryClient.invalidateQueries({ queryKey: researchQueryKeys.all });
  });
}
