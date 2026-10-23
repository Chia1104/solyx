import { useQuery } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";

import type { SymbolRef } from "@solyx/core/market";

import { client, forEachEvent, orpc } from "../../app/rpc.ts";

/** The window the symbol page shows. */
export const NEWS_DAYS = 7;

/** The window the overview's headlines are drawn from. */
export const HEADLINE_DAYS = 7;

const HEADLINE_COUNT = 8;

/** Never stale: the main process says when what is stored about the listing changes. */
const newsReadingQuery = (symbol: SymbolRef) =>
  orpc.news.reading.queryOptions({
    input: { symbol: symbol, days: NEWS_DAYS },
    staleTime: Infinity,
  });

/** The listing's stories, gauge and daily stance over the symbol page's window; `reading` is `undefined` until they arrive. */
export function useNewsReading(symbol: SymbolRef) {
  const { data: reading, error, refetch } = useQuery(newsReadingQuery(symbol));

  return { reading, error, refetch };
}

/** Goes stale on its own too, since saving or deleting a key changes which sources cover a market. */
export const newsCoverageQuery = (symbol: SymbolRef) =>
  orpc.news.coverage.queryOptions({ input: symbol });

/** Never stale: the main process says when what is stored about any listing changes. */
export const newsHeadlinesQuery = (symbols: SymbolRef[]) =>
  orpc.news.headlines.queryOptions({
    input: {
      symbols: symbols,
      days: HEADLINE_DAYS,
      limit: HEADLINE_COUNT,
    },
    staleTime: Infinity,
  });

/**
 * Refetches a listing's news whenever the main process collects or scores some, and every
 * listing's coverage and the headlines, since sources are shared and headlines span listings.
 */
export function followNewsChanges(queryClient: QueryClient) {
  void forEachEvent(client.news.changes(), (symbol) => {
    void queryClient.invalidateQueries({
      queryKey: orpc.news.reading.key({
        input: { symbol: symbol },
      }),
    });
    void queryClient.invalidateQueries({ queryKey: orpc.news.coverage.key() });
    void queryClient.invalidateQueries({ queryKey: orpc.news.headlines.key() });
  });
}
