import { useEffect } from "react";

import { queryOptions, useQueryClient } from "@tanstack/react-query";

import type { SymbolRef } from "@solyx/core/market";

/** The window the symbol page shows. */
export const NEWS_DAYS = 7;

const all = ["news"] as const;

const coverage = [...all, "coverage"] as const;

export const newsQueryKeys = {
  all,
  records: (symbol: SymbolRef) =>
    [...all, "records", symbol.market, symbol.symbol] as const,
  coverage: (symbol: SymbolRef) =>
    [...coverage, symbol.market, symbol.symbol] as const,
};

/** Never stale: the main process says when what is stored about the listing changes. */
export const newsRecordsQuery = (symbol: SymbolRef) =>
  queryOptions({
    queryKey: newsQueryKeys.records(symbol),
    queryFn: () => window.solyx.news.records(symbol, NEWS_DAYS),
    staleTime: Infinity,
  });

/** Goes stale on its own too, since saving or deleting a key changes which sources cover a market. */
export const newsCoverageQuery = (symbol: SymbolRef) =>
  queryOptions({
    queryKey: newsQueryKeys.coverage(symbol),
    queryFn: () => window.solyx.news.coverage(symbol),
  });

/**
 * Refetches a listing's news whenever the main process collects or scores some, and every
 * listing's coverage, since sources are shared.
 */
export function useNewsChanges() {
  const queryClient = useQueryClient();

  useEffect(
    () =>
      window.solyx.news.onChanged((symbol) => {
        void queryClient.invalidateQueries({
          queryKey: newsQueryKeys.records(symbol),
        });
        void queryClient.invalidateQueries({ queryKey: coverage });
      }),
    [queryClient]
  );
}
