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

/** Carries the data behind a rejection, not text; presenters localize it. */
export type RiskViolation =
  | { code: typeof RiskViolationCode.InvalidQuantity; market: Market }
  | { code: typeof RiskViolationCode.InvalidPrice; price: number; tick: number }
  | { code: typeof RiskViolationCode.OddLotMarketOrder }
  | {
      code: typeof RiskViolationCode.OutsidePriceBand;
      low: number;
      high: number;
    }
  | { code: typeof RiskViolationCode.MissingReferencePrice }
  | {
      code: typeof RiskViolationCode.OrderTooLarge;
      notional: number;
      currency: Currency;
      max: number;
    }
  | { code: typeof RiskViolationCode.SessionNotAllowed; session: Session };

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
  const { instrument, quantity } = order;
  const isTw = instrument.market === Market.TW;

  if (isTw ? !isValidTwQuantity(quantity) : !isValidUsQuantity(quantity)) {
    violations.push({
      code: RiskViolationCode.InvalidQuantity,
      market: instrument.market,
    });
  }

  if (order.type === OrderType.Limit) {
    const tick = tickSize(instrument, order.limitPrice);

    if (!(order.limitPrice > 0) || !isOnTick(order.limitPrice, tick)) {
      violations.push({
        code: RiskViolationCode.InvalidPrice,
        price: order.limitPrice,
        tick,
      });
    }

    const band = context.priceBand;

    if (band && (order.limitPrice < band.low || order.limitPrice > band.high)) {
      violations.push({
        code: RiskViolationCode.OutsidePriceBand,
        low: band.low,
        high: band.high,
      });
    }
  } else if (isTw && isTwOddLot(quantity)) {
    violations.push({ code: RiskViolationCode.OddLotMarketOrder });
  }

  const referencePrice =
    order.type === OrderType.Limit ? order.limitPrice : context.lastPrice;

  if (referencePrice === undefined) {
    violations.push({ code: RiskViolationCode.MissingReferencePrice });
  } else {
    const currency = currencyOf(instrument.market);
    const notional = referencePrice * quantity;
    const max = limits.maxOrderNotional[currency];

    if (notional > max) {
      violations.push({
        code: RiskViolationCode.OrderTooLarge,
        notional,
        currency,
        max,
      });
    }
  }

  if (!limits.allowedSessions.includes(context.session)) {
    violations.push({
      code: RiskViolationCode.SessionNotAllowed,
      session: context.session,
    });
  }

  return violations;
}
