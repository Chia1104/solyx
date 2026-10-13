import { queryOptions } from "@tanstack/react-query";

import { symbolKey } from "@solyx/core/market";
import type { SymbolRef } from "@solyx/core/market";

const all = ["fundamentals"] as const;

export const fundamentalsQueryKeys = {
  all,
  trends: (symbol: SymbolRef) => [...all, "trends", symbolKey(symbol)] as const,
};

/**
 * Goes stale on its own, since nothing pushes when a quarter or a month comes out. The main
 * process keeps each listing's answer for half a day, so reading it again asks the source nothing.
 */
export const financialTrendsQuery = (symbol: SymbolRef) =>
  queryOptions({
    queryKey: fundamentalsQueryKeys.trends(symbol),
    queryFn: () => window.solyx.fundamentals.trends(symbol),
  });
