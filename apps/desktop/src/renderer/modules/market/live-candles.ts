import { useEffect, useState } from "react";

import { useQueryClient } from "@tanstack/react-query";

import { upsertCandles } from "@solyx/core/candles";
import type { Interval } from "@solyx/core/candles";
import type { SymbolRef } from "@solyx/core/market";

import { client, forEachEvent } from "../../app/rpc.ts";

import { candlesQuery } from "./candles-query.ts";

/**
 * Keeps the chart's query in step with today's bars while `enabled`; returns whether a live
 * stream covers the symbol, so the query can stop polling. Follows again whenever the sources
 * change, since the new stream may take the symbol or refuse it.
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

  useEffect(() => {
    const stop = new AbortController();
    const { signal } = stop;

    void forEachEvent(
      client.market.sourceChanges(undefined, { signal }),
      () => setSources((count) => count + 1),
      signal
    );

    return () => stop.abort();
  }, []);

  useEffect(() => {
    if (!enabled) return;

    const watched = { market, symbol: code };
    const { queryKey } = candlesQuery(watched, interval);
    const stop = new AbortController();
    const { signal } = stop;

    void forEachEvent(
      client.market.liveCandles({ symbol: watched, interval }, { signal }),
      (bars) => {
        // The first batch, an empty one, says a live stream covers the symbol.
        setLive(true);

        if (bars.length === 0) return;

        // Today's bars belong to the first page, the one that reaches now.
        queryClient.setQueryData(queryKey, (data) => {
          if (!data) return data;

          const [latest, ...older] = data.pages;

          return {
            ...data,
            pages: [
              { ...latest, candles: upsertCandles(latest.candles, bars) },
              ...older,
            ],
          };
        });
      },
      signal
    );

    return () => {
      stop.abort();
      setLive(false);
    };
  }, [enabled, queryClient, market, code, interval, sources]);

  return live;
}
