import { expect, test } from "vite-plus/test";

import {
  MacroFigure,
  MacroIndicator,
  MacroUnit,
  macroReadings,
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
    { period: "2025-08", value: 100 },
    { period: "2025-09", value: 100 },
    { period: "2026-08", value: 102 },
    { period: "2026-09", value: 102.5 },
  ],
};

const SIGNAL: MacroSeries = {
  market: Market.TW,
  indicator: MacroIndicator.BusinessSignal,
  figure: MacroFigure.BusinessSignal,
  unit: MacroUnit.Points,
  observations: [
    { period: "2025-09", value: 30 },
    { period: "2026-08", value: 41 },
    { period: "2026-09", value: 39 },
  ],
};

test("each period reads against the one before it and the same one a year before", () => {
  const readings = macroReadings(PRICES);

  expect(readings[0]).toEqual({
    figure: MacroFigure.ConsumerPrices,
    unit: MacroUnit.Index,
    period: "2025-08",
    value: 100,
    previous: null,
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
