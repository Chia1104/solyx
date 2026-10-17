import { expect, test } from "vite-plus/test";

import { TW_BOARD_LOT, twTickSize } from "@solyx/core/rules/tw";

import {
  LISTINGS,
  candlesFor,
  sessionChange,
} from "../src/components/workspace/listings.ts";
import { Ask, turnFor } from "../src/components/workspace/script.ts";

const onTick = (price: number, code: string) => {
  const steps = price / twTickSize(price, code);

  return Math.abs(steps - Math.round(steps)) < 1e-6;
};

test.each(LISTINGS)(
  "$code's bars end at its quote, on its ticks",
  (listing) => {
    const candles = candlesFor(listing);

    expect(candlesFor(listing)).toEqual(candles);
    expect(candles.at(-1)?.close).toBe(listing.last);
    expect(sessionChange(candles).ratio).toBeCloseTo(listing.change, 3);

    for (const bar of candles) {
      expect(bar.low).toBeLessThanOrEqual(Math.min(bar.open, bar.close));
      expect(bar.high).toBeGreaterThanOrEqual(Math.max(bar.open, bar.close));

      for (const price of [bar.open, bar.high, bar.low, bar.close]) {
        expect(onTick(price, listing.code)).toBe(true);
      }
    }
  }
);

test.each(LISTINGS)(
  "$code's proposal is a board lot on the tick",
  (listing) => {
    const { proposal } = turnFor(Ask.Proposal, listing, candlesFor(listing));

    expect(proposal?.quantity).toBe(TW_BOARD_LOT);
    expect(onTick(proposal?.price ?? Number.NaN, listing.code)).toBe(true);
    expect(proposal?.price).toBeGreaterThan(listing.last * 0.9);
    expect(proposal?.price).toBeLessThanOrEqual(listing.last * 1.1);
  }
);

test.each(LISTINGS)("$code's forecast bands meet edge to edge", (listing) => {
  const { forecast } = turnFor(Ask.Forecast, listing, candlesFor(listing));
  const [below, range, above] = forecast?.scenarios ?? [];

  expect(below.low).toBeNull();
  expect(below.high).toBe(range.low);
  expect(range.high).toBe(above.low);
  expect(above.high).toBeNull();
  expect(
    forecast?.scenarios.reduce((sum, scenario) => sum + scenario.probability, 0)
  ).toBeCloseTo(1);
});
