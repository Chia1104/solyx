import type { Market, SymbolRef } from "@solyx/core/market";

import { orpc } from "../../app/rpc.ts";

/** Goes stale on its own, since nothing pushes when a session's figures come out. */
export const listingFlowsQuery = (symbol: SymbolRef) =>
  orpc.flows.listing.queryOptions({ input: symbol });

export const marketFlowsQuery = (market: Market) =>
  orpc.flows.market.queryOptions({ input: market });
