import * as z from "zod";

import { symbolRefSchema } from "./market.ts";
import type { Currency, SymbolRef } from "./market.ts";

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
  instrument: symbolRefSchema,
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
  instrument: SymbolRef;
  quantity: number;
  avgPrice: number;
}

export interface AccountSnapshot {
  cash: Partial<Record<Currency, number>>;
  positions: Position[];
}

/** A position marked at a price. */
export interface PositionValue {
  /** What it is worth at that price. */
  value: number;
  /** What it cost, at its average price. */
  cost: number;
  /** Its worth less its cost. */
  gain: number;
  /** The gain as a fraction of the cost; `null` for a position that cost nothing. */
  gainPercent: number | null;
}

export function positionValue(
  { quantity, avgPrice }: Pick<Position, "quantity" | "avgPrice">,
  price: number
): PositionValue {
  const value = quantity * price;
  const cost = quantity * avgPrice;

  return {
    value,
    cost,
    gain: value - cost,
    gainPercent: cost === 0 ? null : (value - cost) / cost,
  };
}
