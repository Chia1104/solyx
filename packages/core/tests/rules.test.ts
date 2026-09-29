import { describe, expect, test } from "vite-plus/test";

import { InstrumentKind } from "../src/market.ts";
import { isValidTwQuantity, twTickSize } from "../src/rules/tw.ts";
import { usTickSize } from "../src/rules/us.ts";

describe("twTickSize", () => {
  test.each([
    [9.99, 0.01],
    [10, 0.05],
    [49.95, 0.05],
    [50, 0.1],
    [100, 0.5],
    [500, 1],
    [999, 1],
    [1000, 5],
  ])("stock at %d ticks by %d", (price, tick) => {
    expect(twTickSize(price, InstrumentKind.Stock)).toBe(tick);
  });

  test("ETFs switch to 0.05 at 50", () => {
    expect(twTickSize(49.99, InstrumentKind.ETF)).toBe(0.01);
    expect(twTickSize(180, InstrumentKind.ETF)).toBe(0.05);
  });
});

describe("isValidTwQuantity", () => {
  test.each([1, 999, 1000, 3000])("%d shares is valid", (quantity) => {
    expect(isValidTwQuantity(quantity)).toBe(true);
  });

  test.each([0, -1000, 1.5, 1500])("%d shares is invalid", (quantity) => {
    expect(isValidTwQuantity(quantity)).toBe(false);
  });
});

test("usTickSize allows sub-penny only below $1", () => {
  expect(usTickSize(0.5)).toBe(0.0001);
  expect(usTickSize(1)).toBe(0.01);
});
