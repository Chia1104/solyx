import { sumBy } from "es-toolkit";
import * as z from "zod";

import { currencyOf, symbolKey, symbolRefSchema } from "./market.ts";
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
  /**
   * The shares a sale can draw on now, less those its working sales hold back, as the broker
   * reports them; missing where the broker holds none back, so every share held can be sold.
   */
  sellable?: number;
}

export interface AccountSnapshot {
  /** What the account can spend per currency; `null` where the broker cannot say, which refuses its buys. */
  cash: Partial<Record<Currency, number | null>>;
  positions: Position[];
}

/** An order filled, whole or in part, as the broker reports it. */
export interface Fill {
  /** The broker's id of the order it filled. */
  orderId: string;
  instrument: SymbolRef;
  side: Side;
  quantity: number;
  price: number;
  /** UTC milliseconds. */
  filledAt: number;
  /**
   * What a sale gained over the average cost of the shares it sold, as the broker reckons it;
   * `null` for a buy, or a sale the broker has yet to reckon.
   */
  realized: number | null;
}

/**
 * What the fills' sales in `currency` gained in all, a loss below zero; `null` while the broker
 * has yet to reckon one of them.
 */
export function realizedIn(
  fills: readonly Fill[],
  currency: Currency
): number | null {
  const sales = fills.filter(
    ({ instrument, side }) =>
      side === Side.Sell && currencyOf(instrument.market) === currency
  );

  if (sales.some(({ realized }) => realized === null)) return null;

  return sumBy(sales, ({ realized }) => realized ?? 0);
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

/** What an order leaves the account holding of its currency and its listing. */
export interface OrderImpact {
  currency: Currency;
  /** The limit price times the quantity, before any fee or tax. */
  notional: number;
  /** `null` where the broker cannot say what the account can spend. */
  cash: { before: number; after: number } | null;
  shares: { before: number; after: number };
}

/**
 * What the account would hold once the order fills whole at its limit price, before any fee or
 * tax; `null` for a market order, whose price is not known until it fills.
 */
export function orderImpact(
  order: OrderRequest,
  account: AccountSnapshot
): OrderImpact | null {
  if (order.type !== OrderType.Limit) return null;

  const { instrument, quantity } = order;
  const currency = currencyOf(instrument.market);
  const notional = order.limitPrice * quantity;
  const cash = account.cash[currency];
  const sign = order.side === Side.Buy ? 1 : -1;

  const shares =
    account.positions.find(
      (position) => symbolKey(position.instrument) === symbolKey(instrument)
    )?.quantity ?? 0;

  return {
    currency,
    notional,
    cash:
      cash === null
        ? null
        : { before: cash ?? 0, after: (cash ?? 0) - sign * notional },
    shares: { before: shares, after: shares + sign * quantity },
  };
}
