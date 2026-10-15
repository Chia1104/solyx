import type { QueryClient } from "@tanstack/react-query";

import type { SymbolRef } from "@solyx/core/market";

import { client, forEachEvent, orpc, symbolInput } from "../../app/rpc.ts";

/**
 * Never stale: the main process says when research changes, and as a market's regular session
 * closes, after which reading a listing's coverage settles the forecasts whose horizon ended.
 */
export const researchCoverageQuery = (symbol: SymbolRef) =>
  orpc.research.coverage.queryOptions({
    input: symbolInput(symbol),
    staleTime: Infinity,
  });

/**
 * Refetches research whenever the agent revises a report, its falsifiers are read against the
 * news, a forecast is made or settled, an exchange's day turns or its session opens or closes, or
 * it is cleared, and the calendar with it, which shows the dates reports hold; and research alone whenever a setting changes, since its coverage tells what
 * settings keep the falsifiers from being read.
 */
export function followResearchChanges(queryClient: QueryClient) {
  window.solyx.settings.onChanged(() => {
    void queryClient.invalidateQueries({ queryKey: orpc.research.key() });
  });

  void forEachEvent(client.research.changes(), () => {
    void queryClient.invalidateQueries({ queryKey: orpc.research.key() });
    void queryClient.invalidateQueries({ queryKey: orpc.calendar.key() });
  });
}
