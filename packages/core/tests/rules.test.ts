import { describe, expect, test } from "vite-plus/test";

import {
  isValidTwQuantity,
  twRevenueDeadline,
  twTickSize,
} from "../src/rules/tw.ts";
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
    expect(twTickSize(price, "2330")).toBe(tick);
  });

  test.each([
    ["0050", "an ETF"],
    ["00679B", "a bond ETF"],
    ["00631L", "a leveraged ETF"],
    ["01001T", "a real estate trust"],
    ["020011", "an ETN"],
  ])("%s, %s, ticks by 0.01 below 50 and 0.05 from there", (code) => {
    expect(twTickSize(49.99, code)).toBe(0.01);
    expect(twTickSize(50, code)).toBe(0.05);
    expect(twTickSize(180, code)).toBe(0.05);
  });

  test.each([
    ["2881A", "a preferred share"],
    ["910322", "a depositary receipt"],
    ["1101", "a stock"],
  ])("%s, %s, ticks as a stock", (code) => {
    expect(twTickSize(12, code)).toBe(0.05);
    expect(twTickSize(60, code)).toBe(0.1);
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

test("a month's revenue is due by the tenth of the next, December's in the next year", () => {
  expect(twRevenueDeadline("2026-09")).toBe("2026-10-10");
  expect(twRevenueDeadline("2026-12")).toBe("2027-01-10");
});
