import type { SymbolRef } from "@solyx/core/market";
import { MINUTE_MS } from "@solyx/utils/date";

import { orpc } from "../../app/rpc.ts";

/** The exchange sets a session's limits once, after the session before, so they are read again only now and then. */
const BAND_STALE_MS = 10 * MINUTE_MS;

/** The prices `symbol` may trade between in the session an order placed now goes to. */
export const bandQuery = (symbol: SymbolRef) =>
  orpc.market.band.queryOptions({ input: symbol, staleTime: BAND_STALE_MS });
