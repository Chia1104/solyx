import type { TFunction } from "i18next";

import { Market } from "@solyx/core/market";
import { RiskViolationCode } from "@solyx/core/risk";
import type { RiskViolation } from "@solyx/core/risk";

export function violationMessage(t: TFunction, violation: RiskViolation) {
  switch (violation.code) {
    case RiskViolationCode.PremiseStale:
      return violation.proposedFor === null
        ? t("risk.premise-unknown")
        : t("risk.premise-stale", { date: violation.proposedFor });
    case RiskViolationCode.PriceMoved:
      return t("risk.price-moved", {
        proposedAt: violation.proposedAt,
        price: violation.price,
        max: violation.max * 100,
      });
    case RiskViolationCode.OrdersLocked:
      return t("risk.orders-locked");
    case RiskViolationCode.DailyLossReached:
      return t("risk.daily-loss-reached", {
        loss: violation.loss,
        max: violation.max,
        currency: violation.currency,
      });
    case RiskViolationCode.InvalidQuantity:
      return violation.market === Market.TW
        ? t("risk.invalid-quantity-tw")
        : t("risk.invalid-quantity-us");
    case RiskViolationCode.InvalidPrice:
      return t("risk.invalid-price", {
        price: violation.price,
        tick: violation.tick,
      });
    case RiskViolationCode.OddLotMarketOrder:
      return t("risk.odd-lot-market-order");
    case RiskViolationCode.OutsidePriceBand:
      return t("risk.outside-price-band", {
        low: violation.low,
        high: violation.high,
      });
    case RiskViolationCode.MissingReferencePrice:
      return t("risk.missing-reference-price");
    case RiskViolationCode.OrderTooLarge:
      return t("risk.order-too-large", {
        notional: violation.notional,
        currency: violation.currency,
        max: violation.max,
      });
    case RiskViolationCode.SessionNotAllowed:
      return t("risk.session-not-allowed", {
        session: t(`session.${violation.session}`),
      });
    case RiskViolationCode.UnsupportedMarket:
      return t("risk.unsupported-market", {
        market: t(`market.${violation.market}`),
      });
    case RiskViolationCode.InsufficientCash:
      return t("risk.insufficient-cash", {
        notional: violation.notional,
        cash: violation.cash,
        currency: violation.currency,
      });
    case RiskViolationCode.CashUnknown:
      return t("risk.cash-unknown", { currency: violation.currency });
    case RiskViolationCode.InsufficientShares:
      return t("risk.insufficient-shares", {
        quantity: violation.quantity,
        held: violation.held,
      });
  }
}
