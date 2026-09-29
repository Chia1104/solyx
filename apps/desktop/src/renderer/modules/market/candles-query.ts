import { queryOptions } from "@tanstack/react-query";
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

/**
 * Switching intervals keeps the listing's current bars on screen until the new ones arrive.
 * Intraday charts refresh every minute until streaming quotes arrive.
 */
export const candlesQuery = (symbol: SymbolRef, interval: Interval) =>
  queryOptions({
    queryKey: candlesQueryKeys.of(symbol, interval),
    queryFn: async (): Promise<CandleSet> => ({
      symbol,
      interval,
      candles: await window.solyx.market.candles(symbol, interval),
    }),
    placeholderData: (previous) =>
      previous && isEqual(previous.symbol, symbol) ? previous : undefined,
    refetchInterval: isIntraday(interval) ? 60 * 1000 : false,
  });
