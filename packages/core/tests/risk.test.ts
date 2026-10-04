import { expect, test } from "vite-plus/test";

import { InstrumentKind, Market } from "../src/market.ts";
import type { Instrument } from "../src/market.ts";
import { OrderType, Side } from "../src/order.ts";
import type { OrderRequest } from "../src/order.ts";
import { RiskViolationCode, checkOrder } from "../src/risk.ts";
import type { RiskContext, RiskLimits } from "../src/risk.ts";
import { Session } from "../src/session.ts";

const limits: RiskLimits = {
  maxOrderNotional: { TWD: 1_000_000, USD: 10_000 },
  allowedSessions: [Session.Regular],
};

const tsmc: Instrument = {
  market: Market.TW,
  symbol: "2330",
  kind: InstrumentKind.Stock,
};

const open: RiskContext = {
  session: Session.Regular,
  markets: [Market.TW, Market.US],
  account: {
    cash: { TWD: 2_000_000, USD: 10_000 },
    positions: [{ instrument: tsmc, quantity: 1000, avgPrice: 900 }],
  },
};

const apple: Instrument = {
  market: Market.US,
  symbol: "AAPL",
  kind: InstrumentKind.Stock,
};

function buyLimit(quantity: number, limitPrice: number): OrderRequest {
  return {
    instrument: tsmc,
    side: Side.Buy,
    quantity,
    type: OrderType.Limit,
    limitPrice,
  };
}

function codes(order: OrderRequest, context: RiskContext = open) {
  return checkOrder(order, limits, context).map((v) => v.code);
}

test("a sane TW limit order passes", () => {
  expect(codes(buyLimit(1000, 980))).toEqual([]);
});

test("price off the tick grid is rejected", () => {
  expect(codes(buyLimit(1, 580.3))).toEqual([RiskViolationCode.InvalidPrice]);
});

test("mixed board/odd lot quantity is rejected", () => {
  expect(codes(buyLimit(1500, 500))).toEqual([
    RiskViolationCode.InvalidQuantity,
  ]);
});

test("odd lots cannot be market orders", () => {
  const order: OrderRequest = {
    instrument: tsmc,
    side: Side.Sell,
    quantity: 10,
    type: OrderType.Market,
  };

  expect(codes(order, { ...open, lastPrice: 980 })).toEqual([
    RiskViolationCode.OddLotMarketOrder,
  ]);
});

test("market orders without a reference price cannot be sized", () => {
  const order: OrderRequest = {
    instrument: tsmc,
    side: Side.Buy,
    quantity: 1000,
    type: OrderType.Market,
  };

  expect(codes(order)).toEqual([RiskViolationCode.MissingReferencePrice]);
});

test("limit price outside the daily limit band is rejected", () => {
  const context: RiskContext = {
    ...open,
    priceBand: { low: 882, high: 970 },
  };

  expect(codes(buyLimit(1000, 990), context)).toEqual([
    RiskViolationCode.OutsidePriceBand,
  ]);
});

test("orders over the notional cap are rejected", () => {
  expect(codes(buyLimit(2000, 980))).toEqual([RiskViolationCode.OrderTooLarge]);
});

test("orders outside allowed sessions are rejected", () => {
  const order: OrderRequest = {
    instrument: apple,
    side: Side.Buy,
    quantity: 10,
    type: OrderType.Limit,
    limitPrice: 230.12,
  };

  expect(codes(order, { ...open, session: Session.Post })).toEqual([
    RiskViolationCode.SessionNotAllowed,
  ]);
});

test("a market the broker does not trade is rejected", () => {
  const order: OrderRequest = {
    instrument: apple,
    side: Side.Buy,
    quantity: 10,
    type: OrderType.Limit,
    limitPrice: 230.12,
  };

  expect(checkOrder(order, limits, { ...open, markets: [Market.TW] })).toEqual([
    { code: RiskViolationCode.UnsupportedMarket, market: Market.US },
  ]);
});

test("a buy past the account's cash is rejected", () => {
  const poorer: RiskContext = {
    ...open,
    account: { ...open.account, cash: { TWD: 500_000 } },
  };

  expect(checkOrder(buyLimit(1000, 980), limits, poorer)).toEqual([
    {
      code: RiskViolationCode.InsufficientCash,
      notional: 980_000,
      cash: 500_000,
      currency: "TWD",
    },
  ]);
});

test("a sale of more shares than the account holds is rejected", () => {
  const order: OrderRequest = {
    instrument: tsmc,
    side: Side.Sell,
    quantity: 2000,
    type: OrderType.Limit,
    limitPrice: 400,
  };

  expect(checkOrder(order, limits, open)).toEqual([
    { code: RiskViolationCode.InsufficientShares, quantity: 2000, held: 1000 },
  ]);
});
