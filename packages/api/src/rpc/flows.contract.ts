import { oc, type } from "@orpc/contract";

import type { ListingFlows, MarketFlows } from "@solyx/core/flows";
import { marketSchema, symbolRefSchema } from "@solyx/core/market";

export const flowsContract = {
  /** Who traded a listing over the last year of sessions, oldest first. */
  listing: oc.input(symbolRefSchema).output(type<ListingFlows>()),
  /** Who traded the whole market and its index future over the same sessions. */
  market: oc.input(marketSchema).output(type<MarketFlows>()),
};
