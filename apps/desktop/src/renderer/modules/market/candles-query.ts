import type { InfiniteData } from "@tanstack/react-query";
import { isEqual } from "es-toolkit";

import { isIntraday } from "@solyx/core/candles";
import type { Interval } from "@solyx/core/candles";
import type { SymbolRef } from "@solyx/core/market";
import { MINUTE_MS } from "@solyx/utils/date";

import type { CandleSet } from "#shared/market.ts";

import { orpc } from "../../app/rpc.ts";

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
 * intervals keeps the listing's current bars on screen until the new ones arrive, each page
 * naming the listing and interval its bars belong to. Intraday charts without a `live` stream
 * refresh every minute.
 */
export const candlesQuery = (
  symbol: SymbolRef,
  interval: Interval,
  live = false
) =>
  orpc.market.candles.infiniteOptions({
    input: (before: number | undefined) => ({
      symbol,
      interval,
      before,
    }),
    initialPageParam: undefined,
    // The history before a page's oldest bar; an empty page has none, so the history ends.
    getNextPageParam: (page) => page.candles[0]?.time,
    select: joinPages,
    placeholderData: (previous) =>
      previous && isEqual(previous.pages[0]?.symbol, symbol)
        ? previous
        : undefined,
    refetchInterval: isIntraday(interval) && !live ? MINUTE_MS : false,
  });
