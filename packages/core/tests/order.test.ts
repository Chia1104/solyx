import { expect, test } from "vite-plus/test";

import { Currency, Market } from "../src/market.ts";
import {
  OrderType,
  Side,
  orderImpact,
  orderRequestSchema,
  positionValue,
} from "../src/order.ts";
import type { AccountSnapshot } from "../src/order.ts";

test("normalizes the symbol and accepts a limit order", () => {
  const order = orderRequestSchema.parse({
    instrument: { market: "TW", symbol: " 0050 " },
    side: "buy",
    quantity: 1000,
    type: "limit",
    limitPrice: 180.05,
  });

  expect(order.instrument.symbol).toBe("0050");
});

test("rejects unknown enum values and missing limit prices", () => {
  const base = {
    instrument: { market: "TW", symbol: "2330" },
    side: "buy",
    quantity: 1000,
  };

  expect(
    orderRequestSchema.safeParse({ ...base, side: "short", type: "market" })
      .success
  ).toBe(false);
  expect(orderRequestSchema.safeParse({ ...base, type: "limit" }).success).toBe(
    false
  );
});

test("marks a position at a price against what it cost", () => {
  expect(positionValue({ quantity: 2000, avgPrice: 1000 }, 1085)).toEqual({
    value: 2_170_000,
    cost: 2_000_000,
    gain: 170_000,
    gainPercent: 0.085,
  });
});

test("a position that cost nothing has no gain to compare", () => {
  expect(positionValue({ quantity: 100, avgPrice: 0 }, 50)).toMatchObject({
    gain: 5000,
    gainPercent: null,
  });
});

const TSMC = { market: Market.TW, symbol: "2330" };

const ACCOUNT: AccountSnapshot = {
  cash: { TWD: 2_000_000, USD: 500 },
  positions: [
    {
      instrument: { market: Market.TW, symbol: "2454" },
      quantity: 50,
      avgPrice: 1200,
    },
    { instrument: TSMC, quantity: 1_000, avgPrice: 900 },
  ],
};

test("a buy spends its notional in its market's currency and adds to the holding", () => {
  expect(
    orderImpact(
      {
        instrument: TSMC,
        side: Side.Buy,
        type: OrderType.Limit,
        limitPrice: 1_005,
        quantity: 500,
      },
      ACCOUNT
    )
  ).toEqual({
    currency: Currency.TWD,
    notional: 502_500,
    cash: { before: 2_000_000, after: 1_497_500 },
    shares: { before: 1_000, after: 1_500 },
  });
});

test("a sale brings its notional in and draws on the holding, and a listing not held starts from none", () => {
  expect(
    orderImpact(
      {
        instrument: TSMC,
        side: Side.Sell,
        type: OrderType.Limit,
        limitPrice: 1_000,
        quantity: 1_000,
      },
      ACCOUNT
    )
  ).toMatchObject({
    cash: { before: 2_000_000, after: 3_000_000 },
    shares: { before: 1_000, after: 0 },
  });

  expect(
    orderImpact(
      {
        instrument: { market: Market.US, symbol: "AAPL" },
        side: Side.Buy,
        type: OrderType.Limit,
        limitPrice: 200,
        quantity: 3,
      },
      ACCOUNT
    )
  ).toEqual({
    currency: Currency.USD,
    notional: 600,
    cash: { before: 500, after: -100 },
    shares: { before: 0, after: 3 },
  });
});

test("a market order has no price to tell its impact by", () => {
  expect(
    orderImpact(
      {
        instrument: TSMC,
        side: Side.Buy,
        type: OrderType.Market,
        quantity: 1_000,
      },
      ACCOUNT
    )
  ).toBeNull();
});
