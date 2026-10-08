import { useEffect, useMemo } from "react";

import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";

import { symbolKey } from "@solyx/core/market";
import type { SymbolRef } from "@solyx/core/market";
import { readNews } from "@solyx/core/news";

import { useListing } from "../market/listing-name.tsx";

/** The window the symbol page shows. */
export const NEWS_DAYS = 7;

/** The window the overview's headlines are drawn from. */
export const HEADLINE_DAYS = 7;

const HEADLINE_COUNT = 8;

const all = ["news"] as const;

const coverage = [...all, "coverage"] as const;

const headlines = [...all, "headlines"] as const;

export const newsQueryKeys = {
  all,
  records: (symbol: SymbolRef) =>
    [...all, "records", symbol.market, symbol.symbol] as const,
  coverage: (symbol: SymbolRef) =>
    [...coverage, symbol.market, symbol.symbol] as const,
  headlines: (symbols: SymbolRef[]) =>
    [...headlines, symbols.map(symbolKey)] as const,
};

/** Never stale: the main process says when what is stored about the listing changes. */
export const newsRecordsQuery = (symbol: SymbolRef) =>
  queryOptions({
    queryKey: newsQueryKeys.records(symbol),
    queryFn: () => window.solyx.news.records(symbol, NEWS_DAYS),
    staleTime: Infinity,
  });

/**
 * The listing's stories, gauge and daily stance over the symbol page's window, read once by its
 * names as soon as they are known; `reading` is `undefined` until its records arrive.
 */
export function useNewsReading(symbol: SymbolRef) {
  const { data, error, refetch } = useQuery(newsRecordsQuery(symbol));
  const listing = useListing(symbol);

  const reading = useMemo(
    () => data && readNews(data, { symbol, listing }),
    [data, symbol, listing]
  );

  return { reading, error, refetch };
}

/** Goes stale on its own too, since saving or deleting a key changes which sources cover a market. */
export const newsCoverageQuery = (symbol: SymbolRef) =>
  queryOptions({
    queryKey: newsQueryKeys.coverage(symbol),
    queryFn: () => window.solyx.news.coverage(symbol),
  });

/** Never stale: the main process says when what is stored about any listing changes. */
export const newsHeadlinesQuery = (symbols: SymbolRef[]) =>
  queryOptions({
    queryKey: newsQueryKeys.headlines(symbols),
    queryFn: () =>
      window.solyx.news.headlines(symbols, HEADLINE_DAYS, HEADLINE_COUNT),
    staleTime: Infinity,
  });

/**
 * Refetches a listing's news whenever the main process collects or scores some, and every
 * listing's coverage and the headlines, since sources are shared and headlines span listings.
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
        void queryClient.invalidateQueries({ queryKey: headlines });
      }),
    [queryClient]
  );
}
