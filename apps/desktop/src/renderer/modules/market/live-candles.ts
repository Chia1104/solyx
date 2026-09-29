import { useEffect, useState } from "react";

import { useQueryClient } from "@tanstack/react-query";

import { upsertCandles } from "@solyx/core/candles";
import type { Interval } from "@solyx/core/candles";
import type { SymbolRef } from "@solyx/core/market";

import { candlesQuery } from "./candles-query.ts";

/**
 * Keeps the chart's query in step with today's pushed bars while `enabled`; returns whether a
 * live stream covers the symbol, so the query can stop polling.
 */
export function useLiveCandles(
  symbol: SymbolRef,
  interval: Interval,
  enabled: boolean
): boolean {
  const queryClient = useQueryClient();
  const [live, setLive] = useState(false);
  const { market, symbol: code } = symbol;

  useEffect(() => {
    if (!enabled) return;

    const watched = { market, symbol: code };
    const { queryKey } = candlesQuery(watched, interval);

    const stop = window.solyx.market.onLiveCandles((updates) => {
      const bars = updates
        .filter(
          (update) =>
            update.interval === interval &&
            update.symbol.market === market &&
            update.symbol.symbol === code
        )
        .map((update) => update.candle);

      if (bars.length === 0) return;

      queryClient.setQueryData(queryKey, (set) =>
        set ? { ...set, candles: upsertCandles(set.candles, bars) } : set
      );
    });

    const watching = window.solyx.market.watchCandles(watched, interval);

    void watching.then(setLive);

    return () => {
      stop();
      setLive(false);
      // An unwatch that overtook its watch would leave the symbol watched.
      void watching.then(() =>
        window.solyx.market.unwatchCandles(watched, interval)
      );
    };
  }, [enabled, queryClient, market, code, interval]);

  return live;
}
