import type { SymbolRef } from "@solyx/core/market";
import type { TwSector } from "@solyx/core/sectors";

import { orpc } from "../../app/rpc.ts";

/**
 * Goes stale on its own, since nothing pushes when a quarter or a month comes out. The main
 * process keeps each listing's answer for half a day, so reading it again asks the source nothing.
 */
export const financialTrendsQuery = (symbol: SymbolRef) =>
  orpc.fundamentals.trends.queryOptions({ input: symbol });

/** Goes stale on its own: the main process keeps the exchange's lists for an hour, and nothing pushes when it publishes a session. */
export const sectorMoversQuery = (sector: TwSector) =>
  orpc.fundamentals.sectorMovers.queryOptions({ input: sector });
