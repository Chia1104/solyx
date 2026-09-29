import * as z from "zod";

import { instrumentSchema } from "./market.ts";
import type { Currency, Instrument } from "./market.ts";

export const Side = {
  Buy: "buy",
  Sell: "sell",
} as const;

export type Side = (typeof Side)[keyof typeof Side];

export const sideSchema = z.enum(Side);

export const OrderType = {
  Limit: "limit",
  Market: "market",
} as const;

export type OrderType = (typeof OrderType)[keyof typeof OrderType];

const orderBaseSchema = z.object({
  instrument: instrumentSchema,
  side: sideSchema,
  /** Always in shares, including Taiwan board lots of 1,000 shares. */
  quantity: z.number(),
});

/** Checks structure only; `checkOrder` owns the trading rules so violations read as domain messages. */
export const orderRequestSchema = z.discriminatedUnion("type", [
  orderBaseSchema.extend({
    type: z.literal(OrderType.Limit),
    limitPrice: z.number(),
  }),
  orderBaseSchema.extend({ type: z.literal(OrderType.Market) }),
]);

export type OrderRequest = z.infer<typeof orderRequestSchema>;

export interface Position {
  instrument: Instrument;
  quantity: number;
  avgPrice: number;
}

export interface AccountSnapshot {
  cash: Partial<Record<Currency, number>>;
  positions: Position[];
}
