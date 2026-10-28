import { useQuery } from "@tanstack/react-query";
import { uniqBy } from "es-toolkit";

import { symbolKey } from "@solyx/core/market";
import type { Market } from "@solyx/core/market";

import { orpc } from "../../app/rpc.ts";

import { watchlistQuery } from "./watchlist-query.ts";

/**
 * What the user holds and watches in `market`, every market where it is `null`, held first and
 * each once, with the keys of those held. An account that fails to read leaves the watchlist.
 */
export function useFollowed(market: Market | null) {
  const account = useQuery(orpc.account.summary.queryOptions());
  const watchlist = useQuery(watchlistQuery());

  const positions = (account.data?.positions ?? []).map(
    ({ instrument: { market, symbol } }) => ({ market, symbol })
  );

  const symbols = uniqBy(
    [...positions, ...(watchlist.data ?? [])],
    symbolKey
  ).filter((symbol) => market === null || symbol.market === market);

  return {
    symbols,
    held: new Set(positions.map(symbolKey)),
    pending: account.isPending || watchlist.isPending,
  };
}
