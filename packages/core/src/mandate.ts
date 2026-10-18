import * as z from "zod";

import { currencySchema, symbolKey, symbolRefSchema } from "./market.ts";
import type { Currency } from "./market.ts";
import { OrderType, sideSchema } from "./order.ts";
import type { OrderRequest } from "./order.ts";

/**
 * What the user lets the order desk send without asking them, proposal by proposal: the agent's
 * proposals that pass every check and fall within it. Only the user sets one, in the app's own
 * settings, and it covers the one broker it was set for, until it expires.
 */
export const mandateSchema = z.object({
  /** The id of the broker it lets orders go to; it lets none go to another. */
  broker: z.string().min(1),
  /** While on, the desk sends nothing itself and only marks the proposals it would have sent. */
  shadow: z.boolean(),
  /** UTC milliseconds; from then on it lets nothing go. */
  expiresAt: z.number().int().positive(),
  /** The listings it covers. */
  listings: z.array(symbolRefSchema).min(1),
  /** The sides it covers: sales alone, or buys too. */
  sides: z.array(sideSchema).min(1),
  /** The most one order may come to, its limit price times its shares, per currency; a currency missing is not covered. */
  maxOrderValue: z.partialRecord(currencySchema, z.number().positive()),
  /** The most the orders it lets go in a market's day may come to, per currency. */
  maxDayValue: z.partialRecord(currencySchema, z.number().positive()),
  /** The most orders it lets go in a market's day. */
  maxDayOrders: z.number().int().positive(),
});

export type Mandate = z.infer<typeof mandateSchema>;

export const MandateViolationCode = {
  Expired: "expired",
  OtherBroker: "other-broker",
  /** The user's own proposals wait for them, as they made them to be confirmed. */
  NotAgent: "not-agent",
  Listing: "listing",
  Side: "side",
  /** A market order's price is not known until it fills, so no value can be held to a limit. */
  MarketOrder: "market-order",
  OrderValue: "order-value",
  DayValue: "day-value",
  DayOrders: "day-orders",
} as const;

export type MandateViolationCode =
  (typeof MandateViolationCode)[keyof typeof MandateViolationCode];

/** Why a mandate does not cover a proposal; carries data, not text, which presenters word. */
export type MandateViolation =
  | {
      code:
        | typeof MandateViolationCode.Expired
        | typeof MandateViolationCode.OtherBroker
        | typeof MandateViolationCode.NotAgent
        | typeof MandateViolationCode.Listing
        | typeof MandateViolationCode.Side
        | typeof MandateViolationCode.MarketOrder;
    }
  | {
      code:
        | typeof MandateViolationCode.OrderValue
        | typeof MandateViolationCode.DayValue;
      value: number;
      /** `null` where the mandate covers no order in the currency. */
      max: number | null;
      currency: Currency;
    }
  | { code: typeof MandateViolationCode.DayOrders; max: number };

/** What a mandate made of a proposal, kept with it. */
export interface MandateVerdict {
  /** The mandate was only shown what it would do. */
  shadow: boolean;
  /** Empty where it covered the proposal, so the desk sent it, or would have in shadow. */
  violations: MandateViolation[];
}

/** What the orders a mandate covered in the proposal's market day came to. */
export interface MandateDay {
  orders: number;
  value: number;
}

/**
 * Why `mandate` does not cover an order the agent or the user proposed to `broker` at `now`,
 * with what the mandate already covered in the order's market day; empty where it does.
 */
export function mandateViolations(
  mandate: Mandate,
  {
    order,
    fromAgent,
    broker,
    currency,
    now,
    day,
  }: {
    order: OrderRequest;
    fromAgent: boolean;
    broker: string;
    currency: Currency;
    now: number;
    day: MandateDay;
  }
): MandateViolation[] {
  const violations: MandateViolation[] = [];

  if (now >= mandate.expiresAt) {
    violations.push({ code: MandateViolationCode.Expired });
  }

  if (mandate.broker !== broker) {
    violations.push({ code: MandateViolationCode.OtherBroker });
  }

  if (!fromAgent) violations.push({ code: MandateViolationCode.NotAgent });

  if (
    !mandate.listings.some(
      (listing) => symbolKey(listing) === symbolKey(order.instrument)
    )
  ) {
    violations.push({ code: MandateViolationCode.Listing });
  }

  if (!mandate.sides.includes(order.side)) {
    violations.push({ code: MandateViolationCode.Side });
  }

  if (order.type !== OrderType.Limit) {
    violations.push({ code: MandateViolationCode.MarketOrder });

    return violations;
  }

  const value = order.limitPrice * order.quantity;
  const maxOrder = mandate.maxOrderValue[currency] ?? null;
  const maxDay = mandate.maxDayValue[currency] ?? null;

  if (maxOrder === null || value > maxOrder) {
    violations.push({
      code: MandateViolationCode.OrderValue,
      value,
      max: maxOrder,
      currency,
    });
  }

  if (maxDay === null || day.value + value > maxDay) {
    violations.push({
      code: MandateViolationCode.DayValue,
      value: day.value + value,
      max: maxDay,
      currency,
    });
  }

  if (day.orders >= mandate.maxDayOrders) {
    violations.push({
      code: MandateViolationCode.DayOrders,
      max: mandate.maxDayOrders,
    });
  }

  return violations;
}
