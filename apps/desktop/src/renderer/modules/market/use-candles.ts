import { useQuery } from "@tanstack/react-query";

import type { Interval } from "@solyx/core/candles";
import type { SymbolRef } from "@solyx/core/market";

import { marketDataQuery } from "../settings/settings-query.ts";

import { candlesQuery } from "./candles-query.ts";
import { useLiveCandles } from "./live-candles.ts";

/**
 * A listing's bars, kept in step with the live stream. Nothing loads until `ready`, while the
 * market's source is missing its settings; `source` says which one, so callers can ask for them.
 */
export function useCandles(symbol: SymbolRef, interval: Interval) {
  const settings = useQuery(marketDataQuery());
  const source = settings.data?.markets[symbol.market];

  // A market without a source still loads, so the main process can say why it has none.
  const ready = source === null || source?.ready === true;

  const live = useLiveCandles(symbol, interval, ready);

  const candles = useQuery({
    ...candlesQuery(symbol, interval, live),
    enabled: ready,
  });

  return { settings, source, ready, candles };
}
