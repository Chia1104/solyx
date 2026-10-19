import { expect, test } from "vite-plus/test";

import { MandateViolationCode, mandateViolations } from "../src/mandate.ts";
import type { Mandate } from "../src/mandate.ts";
import { Market } from "../src/market.ts";
import { OrderType, Side } from "../src/order.ts";
import type { OrderRequest } from "../src/order.ts";

const NOW = Date.parse("2026-10-19T10:00:00+08:00");

const mandate: Mandate = {
  broker: "fubon",
  shadow: false,
  expiresAt: NOW + 1000,
  listings: [{ market: Market.TW, symbol: "2330" }],
  sides: [Side.Sell],
  maxOrderValue: { TWD: 1_100_000 },
  maxDayValue: { TWD: 2_000_000 },
  maxDayOrders: 3,
};

const sale: OrderRequest = {
  instrument: { market: Market.TW, symbol: "2330" },
  side: Side.Sell,
  quantity: 1000,
  type: OrderType.Limit,
  limitPrice: 1000,
};

const ask = (
  order: OrderRequest,
  overrides: Partial<Parameters<typeof mandateViolations>[1]> = {}
) =>
  mandateViolations(mandate, {
    order,
    fromAgent: true,
    broker: "fubon",
    currency: "TWD",
    now: NOW,
    day: { orders: 0, value: 0 },
    ...overrides,
  });

test("covers an agent's limit order on a listing and side it names, within its values", () => {
  expect(ask(sale)).toEqual([]);
});

test("covers nothing once it expired, on another broker, or that the user proposed", () => {
  expect(
    ask(sale, { now: NOW + 1000, broker: "paper", fromAgent: false })
  ).toEqual([
    { code: MandateViolationCode.Expired },
    { code: MandateViolationCode.OtherBroker },
    { code: MandateViolationCode.NotAgent },
  ]);
});

test("covers no listing or side it does not name, and no market order", () => {
  expect(
    ask({
      instrument: { market: Market.TW, symbol: "2454" },
      side: Side.Buy,
      quantity: 1000,
      type: OrderType.Market,
    })
  ).toEqual([
    { code: MandateViolationCode.Listing },
    { code: MandateViolationCode.Side },
    { code: MandateViolationCode.MarketOrder },
  ]);
});

test("holds an order, and the day's, to the values it sets per currency", () => {
  expect(ask({ ...sale, limitPrice: 1200 })).toEqual([
    {
      code: MandateViolationCode.OrderValue,
      value: 1_200_000,
      max: 1_100_000,
      currency: "TWD",
    },
  ]);

  expect(ask(sale, { day: { orders: 3, value: 1_500_000 } })).toEqual([
    {
      code: MandateViolationCode.DayValue,
      value: 2_500_000,
      max: 2_000_000,
      currency: "TWD",
    },
    { code: MandateViolationCode.DayOrders, max: 3 },
  ]);
});

test("covers no order in a currency it sets no value for", () => {
  expect(
    ask(
      {
        ...sale,
        instrument: { market: Market.US, symbol: "AAPL" },
        limitPrice: 200,
      },
      { currency: "USD" }
    )
  ).toContainEqual({
    code: MandateViolationCode.OrderValue,
    value: 200_000,
    max: null,
    currency: "USD",
  });
});
