import { QueryObserver, focusManager } from "@tanstack/react-query";
import type { QueryClient, QueryKey } from "@tanstack/react-query";

import { Market } from "@solyx/core/market";
import type { SymbolRef } from "@solyx/core/market";
import { Session } from "@solyx/core/session";

import { orpc, symbolInput } from "../../app/rpc.ts";

import { marketSessionsQuery } from "./market-sessions-query.ts";

/** Every listing's quote costs a request of the plan's budget, so they refresh at this pace. */
const QUOTE_REFRESH_MS = 2 * 60 * 1000;

/** The sectors cost a request per index. */
const SECTORS_REFRESH_MS = 5 * 60 * 1000;

/** Sessions change with the clock rather than with any write. */
const SESSIONS_REFRESH_MS = 5 * 1000;

/** A market's quotes, every listing's, which refresh together. */
const marketQuotes = (market: Market) =>
  orpc.market.quote.key({ input: { market } });

/** Never stale on its own: `followQuotes` refreshes it, so a listing shown twice costs one request. */
export const quoteQuery = (symbol: SymbolRef) =>
  orpc.market.quote.queryOptions({
    input: symbolInput(symbol),
    staleTime: Infinity,
  });

/** Taiwan's sector indices, which `followQuotes` refreshes only while something shows them. */
export const sectorsQuery = () =>
  orpc.market.sectors.queryOptions({ staleTime: Infinity });

/**
 * The one clock quotes and sectors refresh on, so each costs a request per refresh wherever it
 * shows: at their pace through their market's regular session, and once more as its after-hours
 * session opens, by when the last trades of the day have arrived. What is shown loads again, the
 * rest as it is shown. The sessions it follows are polled here for every reader.
 */
export function followQuotes(queryClient: QueryClient) {
  let sessions: Record<Market, Session> | undefined;

  // A hidden window spends nothing; what it shows loads as it shows again.
  const refresh = (queryKey: QueryKey) =>
    void queryClient.invalidateQueries({
      queryKey,
      refetchType: focusManager.isFocused() ? "active" : "none",
    });

  setInterval(() => {
    for (const market of Object.values(Market)) {
      if (sessions?.[market] === Session.Regular) {
        refresh(marketQuotes(market));
      }
    }
  }, QUOTE_REFRESH_MS);

  setInterval(() => {
    if (sessions?.[Market.TW] === Session.Regular) {
      refresh(orpc.market.sectors.key());
    }
  }, SECTORS_REFRESH_MS);

  new QueryObserver(queryClient, {
    ...marketSessionsQuery(),
    refetchInterval: SESSIONS_REFRESH_MS,
  }).subscribe(({ data }) => {
    if (!data || data === sessions) return;

    const previous = sessions;

    sessions = data;

    // Quotes first read during after-hours are already final, so only a session turning into it counts.
    if (!previous) return;

    for (const market of Object.values(Market)) {
      if (data[market] !== Session.Post || previous[market] === Session.Post) {
        continue;
      }

      refresh(marketQuotes(market));

      if (market === Market.TW) refresh(orpc.market.sectors.key());
    }
  });
}
