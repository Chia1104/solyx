import type { Currency, Instrument } from "./market.ts";

export const Side = {
  Buy: "buy",
  Sell: "sell",
} as const;

export type Side = (typeof Side)[keyof typeof Side];

export const OrderType = {
  Limit: "limit",
  Market: "market",
} as const;

export type OrderType = (typeof OrderType)[keyof typeof OrderType];

interface OrderBase {
  instrument: Instrument;
  side: Side;
  /** Always in shares, including Taiwan board lots of 1,000 shares. */
  quantity: number;
}

export type OrderRequest =
  | (OrderBase & { type: typeof OrderType.Limit; limitPrice: number })
  | (OrderBase & { type: typeof OrderType.Market });

export interface Position {
  instrument: Instrument;
  quantity: number;
  avgPrice: number;
}

export interface AccountSnapshot {
  cash: Partial<Record<Currency, number>>;
  positions: Position[];
}
