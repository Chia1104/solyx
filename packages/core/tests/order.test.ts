import { expect, test } from "vite-plus/test";

import { orderRequestSchema, positionValue } from "../src/order.ts";

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
