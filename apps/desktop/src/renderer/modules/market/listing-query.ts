import type { SymbolRef } from "@solyx/core/market";

import { orpc } from "../../app/rpc.ts";

/** Names rarely change, so each listing is looked up once per session. */
export const listingQuery = (symbol: SymbolRef) =>
  orpc.market.listing.queryOptions({
    input: symbol,
    staleTime: Infinity,
  });
