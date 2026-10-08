import {
  QueryObserver,
  queryOptions,
  useQueries,
  useQuery,
} from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";

import { Market } from "@solyx/core/market";
import type { SymbolRef } from "@solyx/core/market";
import { Session } from "@solyx/core/session";

import {
  marketQueryKeys,
  marketSessionsQuery,
} from "./market-sessions-query.ts";

/** Every listing's quote costs a request of the plan's budget, so they refresh at this pace. */
const QUOTE_REFRESH_MS = 2 * 60 * 1000;

/** The sectors cost a request per index. */
const SECTORS_REFRESH_MS = 5 * 60 * 1000;

export const quoteQueryKeys = {
  market: (market: Market) =>
    [...marketQueryKeys.all, "quote", market] as const,
  of: (symbol: SymbolRef) =>
    [...quoteQueryKeys.market(symbol.market), symbol.symbol] as const,
};

export const sectorsQueryKeys = {
  all: [...marketQueryKeys.all, "sectors"] as const,
};

export const quoteQuery = (symbol: SymbolRef) =>
  queryOptions({
    queryKey: quoteQueryKeys.of(symbol),
    queryFn: () => window.solyx.market.quote(symbol),
  });

export const sectorsQuery = () =>
  queryOptions({
    queryKey: sectorsQueryKeys.all,
    queryFn: () => window.solyx.market.sectors(),
  });

/** Quotes refresh through their market's regular session and keep between sessions. */
function useQuotePace() {
  const { data: sessions } = useQuery(marketSessionsQuery());

  return (market: Market, refreshMs: number) =>
    sessions?.[market] === Session.Regular
      ? { refetchInterval: refreshMs, staleTime: refreshMs }
      : { refetchInterval: false as const, staleTime: Infinity };
}

export function useQuote(symbol: SymbolRef) {
  const pace = useQuotePace();

  return useQuery({
    ...quoteQuery(symbol),
    ...pace(symbol.market, QUOTE_REFRESH_MS),
  });
}

/** Quotes of `symbols`, in their order. */
export function useQuotes(symbols: readonly SymbolRef[]) {
  const pace = useQuotePace();

  return useQueries({
    queries: symbols.map((symbol) => ({
      ...quoteQuery(symbol),
      ...pace(symbol.market, QUOTE_REFRESH_MS),
    })),
  });
}

/** Taiwan's sector indices, which refresh only while something shows them. */
export function useSectors() {
  const pace = useQuotePace();

  return useQuery({
    ...sectorsQuery(),
    ...pace(Market.TW, SECTORS_REFRESH_MS),
  });
}

/**
 * Loads a market's quotes and sectors once more as its after-hours session opens, by when the
 * last trades of the day have arrived. Only a session that turns into after-hours counts, since
 * quotes first read during it are already final.
 */
export function followAfterHours(queryClient: QueryClient) {
  let last: Record<Market, Session> | undefined;

  new QueryObserver(queryClient, marketSessionsQuery()).subscribe(
    ({ data: sessions }) => {
      if (!sessions || sessions === last) return;

      const previous = last;

      last = sessions;

      if (!previous) return;

      for (const market of Object.values(Market)) {
        if (
          sessions[market] !== Session.Post ||
          previous[market] === Session.Post
        ) {
          continue;
        }

        void queryClient.invalidateQueries({
          queryKey: quoteQueryKeys.market(market),
        });

        if (market === Market.TW) {
          void queryClient.invalidateQueries({
            queryKey: sectorsQueryKeys.all,
          });
        }
      }
    }
  );
}
