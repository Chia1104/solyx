import { expect, test } from "vite-plus/test";

import {
  MacroFigure,
  MacroIndicator,
  MacroUnit,
  macroReadings,
  releaseExpectations,
  releaseReadings,
} from "../src/macro.ts";
import type { MacroSeries } from "../src/macro.ts";
import { Market } from "../src/market.ts";

const PRICES: MacroSeries = {
  market: Market.TW,
  indicator: MacroIndicator.ConsumerPrices,
  figure: MacroFigure.ConsumerPrices,
  unit: MacroUnit.Index,
  observations: [
    { period: "2025-08", value: 100, forecast: null },
    { period: "2025-09", value: 100, forecast: null },
    { period: "2026-08", value: 102, forecast: null },
    { period: "2026-09", value: 102.5, forecast: null },
  ],
  expected: null,
};

const SIGNAL: MacroSeries = {
  market: Market.TW,
  indicator: MacroIndicator.BusinessSignal,
  figure: MacroFigure.BusinessSignal,
  unit: MacroUnit.Points,
  observations: [
    { period: "2025-09", value: 30, forecast: null },
    { period: "2026-08", value: 41, forecast: null },
    { period: "2026-09", value: 39, forecast: null },
  ],
  expected: null,
};

test("each period reads against the one before it and the same one a year before", () => {
  const readings = macroReadings(PRICES);

  expect(readings[0]).toEqual({
    figure: MacroFigure.ConsumerPrices,
    unit: MacroUnit.Index,
    period: "2025-08",
    value: 100,
    previous: null,
    forecast: null,
    yoy: null,
  });
  expect(
    readings.map(({ period, value, previous, yoy }) => [
      period,
      value,
      previous,
      yoy?.toFixed(3),
    ])
  ).toEqual([
    ["2025-08", 100, null, undefined],
    ["2025-09", 100, 100, undefined],
    ["2026-08", 102, 100, "0.020"],
    ["2026-09", 102.5, 102, "0.025"],
  ]);
});

test("a score has no growth on the year, only the period before", () => {
  expect(macroReadings(SIGNAL).at(-1)).toEqual({
    figure: MacroFigure.BusinessSignal,
    unit: MacroUnit.Points,
    period: "2026-09",
    value: 39,
    previous: 41,
    forecast: null,
    yoy: null,
  });
});

const prices = (period: string | null) => ({
  market: Market.TW,
  indicator: MacroIndicator.ConsumerPrices,
  period,
});

test("a release reads its own period once that is out, or else the newest out before it", () => {
  const core: MacroSeries = {
    ...PRICES,
    figure: MacroFigure.CoreConsumerPrices,
    observations: PRICES.observations.slice(0, 3),
  };

  // September is out for the headline, and only August for the core.
  expect(
    releaseReadings(prices("2026-09"), [PRICES, SIGNAL, core]).map(
      ({ figure, period }) => [figure, period]
    )
  ).toEqual([
    [MacroFigure.ConsumerPrices, "2026-09"],
    [MacroFigure.CoreConsumerPrices, "2026-08"],
  ]);

  // October's release is still ahead, so its newest figure is September's.
  expect(
    releaseReadings(prices("2026-10"), [PRICES]).map(({ period }) => period)
  ).toEqual(["2026-09"]);

  // A release of a week back reads its own period, not the one out since.
  expect(
    releaseReadings(prices("2026-08"), [PRICES]).map(({ period }) => period)
  ).toEqual(["2026-08"]);

  expect(
    releaseReadings(prices(null), [PRICES]).map(({ period }) => period)
  ).toEqual(["2026-09"]);
});

test("a release has no readings where no series is its indicator's or its market's", () => {
  expect(
    releaseReadings(
      { ...prices("2026-09"), indicator: MacroIndicator.PurchasingManagers },
      [PRICES, SIGNAL]
    )
  ).toEqual([]);
  expect(
    releaseReadings({ ...prices("2026-09"), market: Market.US }, [PRICES])
  ).toEqual([]);
  // Nothing was out yet for a period before the series begins.
  expect(releaseReadings(prices("2025-07"), [PRICES])).toEqual([]);
});

const US_PRICES: MacroSeries = {
  market: Market.US,
  indicator: MacroIndicator.ConsumerPrices,
  figure: MacroFigure.ConsumerPrices,
  unit: MacroUnit.GrowthOnYear,
  observations: [
    { period: "2026-08", value: 3.4, forecast: null },
    { period: "2026-09", value: 3.7, forecast: 3.6 },
  ],
  expected: { period: "2026-10", forecast: 3.8 },
};

test("a figure its source gives as growth on the year reads as that growth, with what was expected of it", () => {
  expect(macroReadings(US_PRICES).at(-1)).toEqual({
    figure: MacroFigure.ConsumerPrices,
    unit: MacroUnit.GrowthOnYear,
    period: "2026-09",
    value: 3.7,
    previous: 3.4,
    forecast: 3.6,
    yoy: expect.closeTo(0.037),
  });
});

test("what the market expects of a release is its own period's, and nothing once a period other than the expected one is asked", () => {
  const release = {
    market: Market.US,
    indicator: MacroIndicator.ConsumerPrices,
  };

  expect(
    releaseExpectations({ ...release, period: "2026-10" }, [US_PRICES, PRICES])
  ).toEqual([
    {
      figure: MacroFigure.ConsumerPrices,
      unit: MacroUnit.GrowthOnYear,
      period: "2026-10",
      forecast: 3.8,
    },
  ]);
  expect(
    releaseExpectations({ ...release, period: "2026-09" }, [US_PRICES])
  ).toEqual([]);
});
