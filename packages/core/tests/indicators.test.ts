import { describe, expect, test } from "vite-plus/test";

import type { Candle } from "../src/candles.ts";
import { bollinger, ema, kd, macd, rsi, sma } from "../src/indicators.ts";

function candle(high: number, low: number, close: number): Candle {
  return { time: 0, open: close, high, low, close, volume: 0 };
}

test("sma averages the trailing window", () => {
  expect(sma([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
});

describe("ema", () => {
  test("seeds with the sma, then smooths", () => {
    expect(ema([2, 4, 6, 8, 10], 3)).toEqual([null, null, 4, 6, 8]);
  });

  test("skips an upstream line's warm-up", () => {
    const line = ema([null, null, 2, 4, 6], 2);

    expect(line.slice(0, 3)).toEqual([null, null, null]);
    expect(line[3]).toBe(3);
    expect(line[4]).toBeCloseTo(5);
  });
});

test("bollinger uses the population deviation", () => {
  const { middle, upper, lower } = bollinger([1, 2, 3, 4, 5], 3, 2);

  expect(middle).toEqual([null, null, 2, 3, 4]);
  expect(upper[2]).toBeCloseTo(2 + 2 * Math.sqrt(2 / 3));
  expect(lower[2]).toBeCloseTo(2 - 2 * Math.sqrt(2 / 3));
});

// StockCharts' worked example; its table rounds the seed averages, so it reads about 0.07 higher.
test("rsi matches Wilder's worked example", () => {
  const closes = [
    44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08, 45.89,
    46.03, 45.61, 46.28, 46.28, 46.0, 46.03, 46.41, 46.22, 45.64,
  ];

  const line = rsi(closes, 14);

  expect(line.slice(0, 14).every((value) => value === null)).toBe(true);
  // Gains of 3.34 against losses of 1.40 over the first 14 changes.
  expect(line[14]).toBeCloseTo(100 - 100 / (1 + 3.34 / 1.4), 6);
  expect(line[15]).toBeCloseTo(66.25, 2);
  expect(line[16]).toBeCloseTo(66.481, 2);
  expect(line[17]).toBeCloseTo(69.347, 2);
  expect(line[18]).toBeCloseTo(66.295, 2);
  expect(line[19]).toBeCloseTo(57.915, 2);
});

test("macd warms up in stages and the histogram is macd minus signal", () => {
  const closes = Array.from(
    { length: 60 },
    (_, i) => 100 + Math.sin(i / 4) * 5
  );

  const result = macd(closes, 12, 26, 9);

  expect(result.macd.findIndex((value) => value !== null)).toBe(25);
  expect(result.signal.findIndex((value) => value !== null)).toBe(33);

  for (let i = 33; i < closes.length; i++) {
    expect(result.histogram[i]).toBeCloseTo(
      (result.macd[i] ?? 0) - (result.signal[i] ?? 0)
    );
  }
});

describe("kd", () => {
  test("smooths RSV by one third from 50", () => {
    const { k, d } = kd(
      [
        candle(10, 8, 9),
        candle(11, 9, 10),
        candle(12, 10, 11),
        candle(12, 11, 12),
      ],
      3
    );

    expect(k.slice(0, 2)).toEqual([null, null]);
    expect(k[2]).toBeCloseTo(58.333, 2);
    expect(d[2]).toBeCloseTo(52.778, 2);
    expect(k[3]).toBeCloseTo(72.222, 2);
    expect(d[3]).toBeCloseTo(59.259, 2);
  });

  test("treats a flat window as mid-range", () => {
    const { k } = kd([candle(5, 5, 5), candle(5, 5, 5)], 2);

    expect(k[1]).toBeCloseTo(50);
  });
});
