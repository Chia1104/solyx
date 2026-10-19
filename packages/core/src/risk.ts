import { Market, currencyOf, symbolKey } from "./market.ts";
import type { Currency, SymbolRef } from "./market.ts";
import { OrderType, Side, exitLegs } from "./order.ts";
import type { AccountSnapshot, ExitRequest, OrderRequest } from "./order.ts";
import { isTwOddLot, isValidTwQuantity, twTickSize } from "./rules/tw.ts";
import { isValidUsQuantity, usTickSize } from "./rules/us.ts";
import { nextTradingDay, sessionDayAt } from "./session.ts";
import type { Session, TradingDays } from "./session.ts";

export interface RiskLimits {
  /** Largest single order, in the market's own currency. */
  maxOrderNotional: Record<Currency, number>;
  allowedSessions: readonly Session[];
}

/** The prices a listing may trade between in one session. */
export interface PriceBand {
  low: number;
  high: number;
}

/** A listing's price limits as its exchange sets them after a session, for the next one the market trades. */
export interface PriceLimits {
  /** The exchange-local day of the session they follow. */
  after: string;
  /** `null` where the listing trades without limits, as a fund of foreign shares does. */
  band: PriceBand | null;
}

/**
 * The band of the session an order placed at `at` goes to: `null` where the listing trades
 * without limits in it, and `undefined` while that session's limits are not known, as they are not
 * once it is past the one `limits` were set for.
 */
export function sessionBand(
  limits: PriceLimits | null,
  market: Market,
  at: Date,
  trades: TradingDays
): PriceBand | null | undefined {
  if (!limits) return undefined;

  return nextTradingDay(limits.after, trades) ===
    sessionDayAt(market, at, trades)
    ? limits.band
    : undefined;
}

/** What the market stood at as an order was proposed, which confirming it checks again. */
export interface OrderPremise {
  /** The exchange-local day of the regular session the order went to. */
  session: string;
  /** The listing's last price; `null` where none could be read. */
  price: number | null;
  /** The band of that session; `null` where it traded without limits or they were not known. */
  band: PriceBand | null;
}

/** The most the price may move from the one a proposal was made at before it is proposed again. */
export const MAX_PREMISE_MOVE = 0.03;

// Prices are decimals that binary numbers only approximate, so a move of exactly the most may read a hair past it.
const MOVE_TOLERANCE = 1e-9;

/**
 * Whatever has changed since an order was proposed that it was argued on: a proposal holds for
 * the session it was made for, and only while the price stays within `MAX_PREMISE_MOVE` of where
 * it was, where both prices are known.
 */
export function premiseViolations(
  then: OrderPremise | null,
  now: Pick<OrderPremise, "session" | "price">
): RiskViolation[] {
  if (then?.session !== now.session) {
    return [
      {
        code: RiskViolationCode.PremiseStale,
        proposedFor: then?.session ?? null,
        session: now.session,
      },
    ];
  }

  if (
    then.price !== null &&
    now.price !== null &&
    Math.abs(now.price - then.price) - then.price * MAX_PREMISE_MOVE >
      then.price * MOVE_TOLERANCE
  ) {
    return [
      {
        code: RiskViolationCode.PriceMoved,
        proposedAt: then.price,
        price: now.price,
        max: MAX_PREMISE_MOVE,
      },
    ];
  }

  return [];
}

/** Market and account state at check time. Re-read before every check; it goes stale fast. */
export interface RiskContext {
  session: Session;
  /** The markets the broker trades. */
  markets: readonly Market[];
  /** What the account holds, which buys spend and sells draw on. */
  account: AccountSnapshot;
  /** The user locked orders, so every one is refused until they unlock them. */
  locked?: boolean;
  /**
   * What the account's sales in the order's currency gained over its market's day so far, a loss
   * below zero, against the most the user lets it lose in a day; unset where they set no limit.
   */
  dailyLoss?: { realized: number | null; max: number };
  /**
   * The listing's band in the session the order goes to (`sessionBand`). A market order is sized
   * at its high, the most it could fill at, so one is refused where the band is `null` or unknown.
   */
  priceBand?: PriceBand | null;
}

export const RiskViolationCode = {
  PremiseStale: "premise-stale",
  PriceMoved: "price-moved",
  OrdersLocked: "orders-locked",
  DailyLossReached: "daily-loss-reached",
  /** A sale of the day's has yet to be reckoned, so how much the day lost is not known. */
  DailyLossUnknown: "daily-loss-unknown",
  InvalidQuantity: "invalid-quantity",
  InvalidPrice: "invalid-price",
  OddLotMarketOrder: "odd-lot-market-order",
  OutsidePriceBand: "outside-price-band",
  MissingReferencePrice: "missing-reference-price",
  OrderTooLarge: "order-too-large",
  SessionNotAllowed: "session-not-allowed",
  UnsupportedMarket: "unsupported-market",
  InsufficientCash: "insufficient-cash",
  /** The broker cannot say what the account can spend, so no buy can be held to it. */
  CashUnknown: "cash-unknown",
  InsufficientShares: "insufficient-shares",
  /** The broker watches no prices itself, so it takes no exit. */
  ExitsUnsupported: "exits-unsupported",
  ExitWithoutPrice: "exit-without-price",
  /** The listing's price cannot be read, so whether a stop or target would sell at once cannot be told. */
  ExitPriceUnknown: "exit-price-unknown",
  /** The listing already trades at or below the stop, so it would sell at once. */
  StopNotBelowPrice: "stop-not-below-price",
  /** The listing already trades at or above the target, so it would sell at once. */
  TargetNotAbovePrice: "target-not-above-price",
  ExitUntilOutOfRange: "exit-until-out-of-range",
} as const;

export type RiskViolationCode =
  (typeof RiskViolationCode)[keyof typeof RiskViolationCode];

/** Carries the data behind a rejection, not text; presenters localize it. */
export type RiskViolation =
  | {
      code: typeof RiskViolationCode.PremiseStale;
      /** The day of the session it was proposed for; `null` where it kept none. */
      proposedFor: string | null;
      session: string;
    }
  | {
      code: typeof RiskViolationCode.PriceMoved;
      proposedAt: number;
      price: number;
      max: number;
    }
  | { code: typeof RiskViolationCode.OrdersLocked }
  | {
      code: typeof RiskViolationCode.DailyLossReached;
      loss: number;
      max: number;
      currency: Currency;
    }
  | {
      code: typeof RiskViolationCode.DailyLossUnknown;
      max: number;
      currency: Currency;
    }
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
  | { code: typeof RiskViolationCode.SessionNotAllowed; session: Session }
  | { code: typeof RiskViolationCode.UnsupportedMarket; market: Market }
  | {
      code: typeof RiskViolationCode.InsufficientCash;
      notional: number;
      cash: number;
      currency: Currency;
    }
  | { code: typeof RiskViolationCode.CashUnknown; currency: Currency }
  | {
      code: typeof RiskViolationCode.InsufficientShares;
      quantity: number;
      /** The shares the account can sell now, those its working sales and other exits hold back left out. */
      held: number;
    }
  | { code: typeof RiskViolationCode.ExitsUnsupported }
  | { code: typeof RiskViolationCode.ExitWithoutPrice }
  | { code: typeof RiskViolationCode.ExitPriceUnknown }
  | {
      code: typeof RiskViolationCode.StopNotBelowPrice;
      stop: number;
      price: number;
    }
  | {
      code: typeof RiskViolationCode.TargetNotAbovePrice;
      target: number;
      price: number;
    }
  | {
      code: typeof RiskViolationCode.ExitUntilOutOfRange;
      /** The first and last exchange-local days an exit may end on. */
      first: string;
      last: string;
    };

export function tickSize(instrument: SymbolRef, price: number): number {
  return instrument.market === Market.TW
    ? twTickSize(price, instrument.symbol)
    : usTickSize(price);
}

export function isOnTick(price: number, tick: number): boolean {
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

  if (context.locked) violations.push({ code: RiskViolationCode.OrdersLocked });

  // A sale only takes risk off, so it still goes once the day's loss reaches the limit, or while
  // it cannot be told.
  if (order.side === Side.Buy && context.dailyLoss) {
    const { realized, max } = context.dailyLoss;
    const currency = currencyOf(instrument.market);

    if (realized === null) {
      violations.push({
        code: RiskViolationCode.DailyLossUnknown,
        max,
        currency,
      });
    } else if (-realized >= max) {
      violations.push({
        code: RiskViolationCode.DailyLossReached,
        loss: -realized,
        max,
        currency,
      });
    }
  }

  if (!context.markets.includes(instrument.market)) {
    violations.push({
      code: RiskViolationCode.UnsupportedMarket,
      market: instrument.market,
    });
  }

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
    order.type === OrderType.Limit ? order.limitPrice : context.priceBand?.high;

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

    // A currency the account lists no cash in holds none.
    const cash = context.account.cash[currency];

    if (order.side === Side.Buy && cash === null) {
      violations.push({ code: RiskViolationCode.CashUnknown, currency });
    } else if (order.side === Side.Buy && notional > (cash ?? 0)) {
      violations.push({
        code: RiskViolationCode.InsufficientCash,
        notional,
        cash: cash ?? 0,
        currency,
      });
    }
  }

  // The app makes no short sales, so a sale draws only on shares the account holds and no
  // working sale holds back already.
  if (order.side === Side.Sell) {
    const position = context.account.positions.find(
      (each) => symbolKey(each.instrument) === symbolKey(instrument)
    );

    const held = position?.sellable ?? position?.quantity ?? 0;

    if (quantity > held) {
      violations.push({
        code: RiskViolationCode.InsufficientShares,
        quantity,
        held,
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

/** The most days after the one it is made on that an exit is watched, inside Fubon's 90 with room for the day it starts. */
export const MAX_EXIT_DAYS = 60;

/** Market and account state an exit is checked against. Re-read before every check. */
export interface ExitContext {
  /** The markets the broker trades. */
  markets: readonly Market[];
  /** What the account holds, which the exit sells from. */
  account: AccountSnapshot;
  /** The user locked orders, so no exit is placed either. */
  locked?: boolean;
  /** Whether the broker watches prices itself (`BrokerAdapter.exits`). */
  watches: boolean;
  /** The listing's last price; `null` where none could be read. */
  price: number | null;
  /** The exchange-local day the check runs on. */
  today: string;
  /** The shares of the listing the account's other exits already sell. */
  covered: number;
}

/**
 * Deterministic checks of an exit before it is proposed and again before it is placed. It sells
 * only shares the account holds that its working sales and other exits leave, and neither price
 * may be reached already, since the broker would sell at once.
 */
export function checkExit(
  request: ExitRequest,
  context: ExitContext
): RiskViolation[] {
  const violations: RiskViolation[] = [];
  const { instrument, quantity, stop, target, until } = request;
  const isTw = instrument.market === Market.TW;

  if (context.locked) violations.push({ code: RiskViolationCode.OrdersLocked });

  if (!context.watches) {
    violations.push({ code: RiskViolationCode.ExitsUnsupported });
  }

  if (!context.markets.includes(instrument.market)) {
    violations.push({
      code: RiskViolationCode.UnsupportedMarket,
      market: instrument.market,
    });
  }

  if (isTw ? !isValidTwQuantity(quantity) : !isValidUsQuantity(quantity)) {
    violations.push({
      code: RiskViolationCode.InvalidQuantity,
      market: instrument.market,
    });
  }

  const legs = exitLegs(request);

  if (legs.length === 0) {
    violations.push({ code: RiskViolationCode.ExitWithoutPrice });
  }

  for (const { price } of legs) {
    const tick = tickSize(instrument, price);

    if (!(price > 0) || !isOnTick(price, tick)) {
      violations.push({ code: RiskViolationCode.InvalidPrice, price, tick });
    }
  }

  const { price } = context;

  if (price === null) {
    if (legs.length > 0) {
      violations.push({ code: RiskViolationCode.ExitPriceUnknown });
    }
  } else {
    if (stop !== null && stop >= price) {
      violations.push({
        code: RiskViolationCode.StopNotBelowPrice,
        stop,
        price,
      });
    }

    if (target !== null && target <= price) {
      violations.push({
        code: RiskViolationCode.TargetNotAbovePrice,
        target,
        price,
      });
    }
  }

  const today = Temporal.PlainDate.from(context.today);
  const first = today.add({ days: 1 });
  const last = today.add({ days: MAX_EXIT_DAYS });

  if (
    Temporal.PlainDate.compare(until, first) < 0 ||
    Temporal.PlainDate.compare(until, last) > 0
  ) {
    violations.push({
      code: RiskViolationCode.ExitUntilOutOfRange,
      first: first.toString(),
      last: last.toString(),
    });
  }

  const position = context.account.positions.find(
    (each) => symbolKey(each.instrument) === symbolKey(instrument)
  );

  const held = Math.max(
    (position?.sellable ?? position?.quantity ?? 0) - context.covered,
    0
  );

  if (quantity > held) {
    violations.push({
      code: RiskViolationCode.InsufficientShares,
      quantity,
      held,
    });
  }

  return violations;
}
