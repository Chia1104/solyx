import type { Market } from "@solyx/core/market";

import { orpc } from "../../app/rpc.ts";

/** Goes stale on its own, since nothing pushes when a figure comes out. */
export const macroSeriesQuery = (market: Market) =>
  orpc.macro.series.queryOptions({ input: market });

/** Goes stale on its own, since nothing pushes when a rate closes. */
export const exchangeRateQuery = () => orpc.macro.exchangeRate.queryOptions();

/** Goes stale on its own, since nothing pushes when the Treasury puts out a day's curve. */
export const yieldsQuery = () => orpc.macro.yields.queryOptions();
