import type { SymbolRef } from "@solyx/core/market";

import { orpc, symbolInput } from "../../app/rpc.ts";

/**
 * Goes stale on its own, since nothing pushes when a quarter or a month comes out. The main
 * process keeps each listing's answer for half a day, so reading it again asks the source nothing.
 */
export const financialTrendsQuery = (symbol: SymbolRef) =>
  orpc.fundamentals.trends.queryOptions({ input: symbolInput(symbol) });
