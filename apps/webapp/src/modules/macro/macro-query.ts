import type { Market } from "@solyx/core/market";

import { orpc } from "../../app/rpc.ts";

/** Goes stale on its own, since nothing pushes when a figure comes out. */
export const macroSeriesQuery = (market: Market) =>
  orpc.macro.series.queryOptions({ input: market });
