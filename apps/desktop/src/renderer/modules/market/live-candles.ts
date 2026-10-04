import { useEffect, useState } from "react";

import { useQueryClient } from "@tanstack/react-query";
import { isEqual } from "es-toolkit";

import { upsertCandles } from "@solyx/core/candles";
import type { Interval } from "@solyx/core/candles";
import type { SymbolRef } from "@solyx/core/market";

import { candlesQuery } from "./candles-query.ts";

/**
 * Keeps the chart's query in step with today's pushed bars while `enabled`; returns whether a
 * live stream covers the symbol, so the query can stop polling. Watches again whenever the
 * sources change, since the new stream may take the symbol or refuse it.
 */
export function useLiveCandles(
  symbol: SymbolRef,
  interval: Interval,
  enabled: boolean
): boolean {
  const queryClient = useQueryClient();
  const [live, setLive] = useState(false);
  const [sources, setSources] = useState(0);
  const { market, symbol: code } = symbol;

  useEffect(
    () =>
      window.solyx.market.onSourcesChanged(() =>
        setSources((count) => count + 1)
      ),
    []
  );

  useEffect(() => {
    if (!enabled) return;

    const watched = { market, symbol: code };
    const { queryKey } = candlesQuery(watched, interval);

    const stop = window.solyx.market.onLiveCandles((updates) => {
      const bars = updates
        .filter(
          (update) =>
            update.interval === interval && isEqual(update.symbol, watched)
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
  }, [enabled, queryClient, market, code, interval, sources]);

  return live;
}
