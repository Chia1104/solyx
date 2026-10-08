import { infiniteQueryOptions } from "@tanstack/react-query";
import type { InfiniteData } from "@tanstack/react-query";
import { isEqual } from "es-toolkit";

import { isIntraday } from "@solyx/core/candles";
import type { Candle, Interval } from "@solyx/core/candles";
import type { SymbolRef } from "@solyx/core/market";

import { marketQueryKeys } from "./market-sessions-query.ts";

export const candlesQueryKeys = {
  all: [...marketQueryKeys.all, "candles"] as const,
  of: (symbol: SymbolRef, interval: Interval) =>
    [...candlesQueryKeys.all, symbol.market, symbol.symbol, interval] as const,
};

/** Bars with the listing and interval they belong to, which stay attached while they stand in for another query. */
export interface CandleSet {
  symbol: SymbolRef;
  interval: Interval;
  candles: Candle[];
}

// The first page's param: it reads the lookback window rather than the history before a bar.
const LOOKBACK_PAGE = -1;

/** The pages joined oldest first: the first page is the lookback window, each next one older. */
function joinPages({ pages }: InfiniteData<CandleSet>): CandleSet {
  return {
    symbol: pages[0].symbol,
    interval: pages[0].interval,
    candles: pages.toReversed().flatMap((page) => page.candles),
  };
}

/**
 * A listing's bars: its interval's lookback window, then a page of older history each time the
 * chart asks for one, until a page comes back empty. A refetch reads every page again, each
 * from before the oldest bar of the one after it, so the pages stay contiguous. Switching
 * intervals keeps the listing's current bars on screen until the new ones arrive. Intraday
 * charts without a `live` stream refresh every minute.
 */
export const candlesQuery = (
  symbol: SymbolRef,
  interval: Interval,
  live = false
) =>
  infiniteQueryOptions({
    queryKey: candlesQueryKeys.of(symbol, interval),
    queryFn: async ({ pageParam }): Promise<CandleSet> => ({
      symbol,
      interval,
      candles:
        pageParam === LOOKBACK_PAGE
          ? await window.solyx.market.candles(symbol, interval)
          : await window.solyx.market.olderCandles(symbol, interval, pageParam),
    }),
    initialPageParam: LOOKBACK_PAGE,
    // The history before a page's oldest bar; an empty page has none, so the history ends.
    getNextPageParam: (page) => page.candles[0]?.time,
    select: joinPages,
    placeholderData: (previous) =>
      previous && isEqual(previous.pages[0]?.symbol, symbol)
        ? previous
        : undefined,
    refetchInterval: isIntraday(interval) && !live ? 60 * 1000 : false,
  });
