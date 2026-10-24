import { describe, expect, test } from "vite-plus/test";

import { Side } from "../src/order.ts";
import {
  isValidTwQuantity,
  twRevenueDeadline,
  twLots,
  twRocDaySchema,
  twSpendable,
  twPriceLimits,
  twTickSize,
  twTradeCosts,
} from "../src/rules/tw.ts";
import { usTickSize } from "../src/rules/us.ts";

describe("twPriceLimits", () => {
  test.each([
    [100, { high: 110, low: 90 }],
    // 500.5 is cut to the tick of 1 it takes, while 409.5 is on its tick of 0.5.
    [455, { high: 500, low: 409.5 }],
    [9.98, { high: 10.95, low: 8.99 }],
    [1005, { high: 1105, low: 905 }],
  ])("a stock from %d moves between its limits", (reference, limits) => {
    expect(twPriceLimits(reference, "2330")).toEqual(limits);
  });

  test("a fund keeps to its own ticks", () => {
    expect(twPriceLimits(45.67, "0050")).toEqual({ high: 50.2, low: 41.11 });
  });
});

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

describe("twRocDaySchema", () => {
  test.each([
    ["1151012", "2026-10-12"],
    ["115/10/12", "2026-10-12"],
    [" 991231 ", "2010-12-31"],
  ])("reads %s as %s", (written, day) => {
    expect(twRocDaySchema.parse(written)).toBe(day);
  });

  test.each(["1150230", "115-10-12", "11510"])("refuses %s", (written) => {
    expect(twRocDaySchema.safeParse(written).success).toBe(false);
  });
});

test("shares count in whole board lots, rounded", () => {
  expect(twLots(12_400)).toBe(12);
  expect(twLots(-2_600)).toBe(-3);
});

test("a Taiwan account spends its bank's balance with every trade not yet settled against it", () => {
  const today = [
    // 100,000 bought, with 142.5 commission.
    { symbol: "2330", side: Side.Buy, quantity: 100, price: 1000 },
    // 50,000 of a fund sold, less 71.25 commission and 50 tax.
    { symbol: "0050", side: Side.Sell, quantity: 1000, price: 50 },
    // An odd lot pays the least commission.
    { symbol: "2330", side: Side.Buy, quantity: 1, price: 1000 },
  ];

  expect(twSpendable(1_000_000, [-200_000, 30_000], today)).toBeCloseTo(
    1_000_000 - 200_000 + 30_000 - 100_142.5 + 49_878.75 - 1_020
  );
});

describe("twTradeCosts", () => {
  test("a buy pays the commission, rounded down, and no tax", () => {
    expect(twTradeCosts(2_080_000, Side.Buy, "2330")).toEqual({
      commission: 2964,
      tax: 0,
    });
  });

  test("a sale pays a stock's tax, a fund's less, and a small trade the least commission", () => {
    expect(twTradeCosts(104_500, Side.Sell, "2330")).toEqual({
      commission: 148,
      tax: 313,
    });
    expect(twTradeCosts(5_000, Side.Sell, "0050")).toEqual({
      commission: 20,
      tax: 5,
    });
  });
});
