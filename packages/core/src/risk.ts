import { Market, currencyOf } from "./market.ts";
import type { Currency, Instrument } from "./market.ts";
import { OrderType } from "./order.ts";
import type { OrderRequest } from "./order.ts";
import { isTwOddLot, isValidTwQuantity, twTickSize } from "./rules/tw.ts";
import { isValidUsQuantity, usTickSize } from "./rules/us.ts";
import type { Session } from "./session.ts";

export interface RiskLimits {
  /** Largest single order, in the market's own currency. */
  maxOrderNotional: Record<Currency, number>;
  allowedSessions: readonly Session[];
}

/** Market state at check time. Re-read before every check; it goes stale fast. */
export interface RiskContext {
  session: Session;
  /** Needed to size market orders. */
  lastPrice?: number;
  /** Daily price-limit band from the quote feed; some TW ETFs have none, so it stays optional. */
  priceBand?: { low: number; high: number };
}

export const RiskViolationCode = {
  InvalidQuantity: "invalid-quantity",
  InvalidPrice: "invalid-price",
  OddLotMarketOrder: "odd-lot-market-order",
  OutsidePriceBand: "outside-price-band",
  MissingReferencePrice: "missing-reference-price",
  OrderTooLarge: "order-too-large",
  SessionNotAllowed: "session-not-allowed",
} as const;

export type RiskViolationCode =
  (typeof RiskViolationCode)[keyof typeof RiskViolationCode];

export interface RiskViolation {
  code: RiskViolationCode;
  message: string;
}

function tickSize(instrument: Instrument, price: number): number {
  return instrument.market === Market.TW
    ? twTickSize(price, instrument.kind)
    : usTickSize(price);
}

function isOnTick(price: number, tick: number): boolean {
  const steps = price / tick;

  return Math.abs(steps - Math.round(steps)) < 1e-6;
}

/** Deterministic pre-trade checks. An empty result means the order may be sent. */
export function checkOrder(
  order: OrderRequest,
  limits: RiskLimits,
  context: RiskContext
): RiskViolation[] {
  const violations: RiskViolation[] = [];

  const add = (code: RiskViolationCode, message: string) =>
    violations.push({ code, message });

  const { instrument, quantity } = order;
  const isTw = instrument.market === Market.TW;

  if (isTw ? !isValidTwQuantity(quantity) : !isValidUsQuantity(quantity)) {
    add(
      RiskViolationCode.InvalidQuantity,
      isTw
        ? "Taiwan orders must be 1–999 odd-lot shares or a multiple of 1,000"
        : "US orders must be a positive whole number of shares"
    );
  }

  if (order.type === OrderType.Limit) {
    const tick = tickSize(instrument, order.limitPrice);

    if (!(order.limitPrice > 0) || !isOnTick(order.limitPrice, tick)) {
      add(
        RiskViolationCode.InvalidPrice,
        `Price ${order.limitPrice} is not a multiple of the ${tick} tick size`
      );
    }

    const band = context.priceBand;

    if (band && (order.limitPrice < band.low || order.limitPrice > band.high)) {
      add(
        RiskViolationCode.OutsidePriceBand,
        `Price is outside the daily limit band ${band.low}–${band.high}`
      );
    }
  } else if (isTw && isTwOddLot(quantity)) {
    add(
      RiskViolationCode.OddLotMarketOrder,
      "Odd-lot orders must be limit orders"
    );
  }

  const referencePrice =
    order.type === OrderType.Limit ? order.limitPrice : context.lastPrice;

  if (referencePrice === undefined) {
    add(
      RiskViolationCode.MissingReferencePrice,
      "Market orders need a last price to estimate their value"
    );
  } else {
    const currency = currencyOf(instrument.market);
    const notional = referencePrice * quantity;
    const max = limits.maxOrderNotional[currency];

    if (notional > max) {
      add(
        RiskViolationCode.OrderTooLarge,
        `Order value ${notional} ${currency} exceeds the ${max} limit`
      );
    }
  }

  if (!limits.allowedSessions.includes(context.session)) {
    add(
      RiskViolationCode.SessionNotAllowed,
      `Orders are not allowed in the ${context.session} session`
    );
  }

  return violations;
}
