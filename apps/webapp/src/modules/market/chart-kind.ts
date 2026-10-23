import * as z from "zod";

/** What the symbol page charts: bars of the interval picked, or the newest session against its reference. */
export const ChartKind = {
  Candles: "candles",
  Session: "session",
} as const;

export type ChartKind = (typeof ChartKind)[keyof typeof ChartKind];

export const chartKindSchema = z.enum(ChartKind);
