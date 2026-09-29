import { expect, test } from "vite-plus/test";

import { orderRequestSchema } from "../src/order.ts";

test("normalizes the symbol and accepts a limit order", () => {
  const order = orderRequestSchema.parse({
    instrument: { market: "TW", symbol: " 0050 ", kind: "etf" },
    side: "buy",
    quantity: 1000,
    type: "limit",
    limitPrice: 180.05,
  });

  expect(order.instrument.symbol).toBe("0050");
});

test("rejects unknown enum values and missing limit prices", () => {
  const base = {
    instrument: { market: "TW", symbol: "2330", kind: "stock" },
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
