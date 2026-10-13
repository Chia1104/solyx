import { expect, test } from "vite-plus/test";

import {
  RangeSide,
  forecastMarks,
  rangePlace,
} from "../src/renderer/modules/research/research-figures.ts";

test("a price inside a range is placed between its ends, which keep clear of the scale's edges", () => {
  const place = rangePlace(900, 1100, 1000);

  expect(place.side).toBe(RangeSide.Within);
  expect(place.from).toBeCloseTo(0.1);
  expect(place.at).toBeCloseTo(0.5);
  expect(place.to).toBeCloseTo(0.9);
  expect(place.fromLow).toBeCloseTo(1000 / 900 - 1);
  expect(place.fromHigh).toBeCloseTo(1000 / 1100 - 1);
});

test("a price past a range stretches the scale to hold it", () => {
  const below = rangePlace(900, 1100, 800);

  expect(below.side).toBe(RangeSide.Below);
  expect(below.at).toBeCloseTo(0.1);
  expect(below.to).toBeCloseTo(0.9);
  expect(below.fromLow).toBeCloseTo(800 / 900 - 1);

  const above = rangePlace(900, 1100, 1300);

  expect(above.side).toBe(RangeSide.Above);
  expect(above.from).toBeCloseTo(0.1);
  expect(above.at).toBeCloseTo(0.9);
  expect(above.fromHigh).toBeCloseTo(1300 / 1100 - 1);
});

test("a price on a range's end is within it, and a range of no width sits mid-scale", () => {
  expect(rangePlace(900, 1100, 900).side).toBe(RangeSide.Within);
  expect(rangePlace(900, 1100, 1100).side).toBe(RangeSide.Within);
  expect(rangePlace(1000, 1000, 1000)).toMatchObject({
    from: 0.5,
    to: 0.5,
    at: 0.5,
  });
});

const forecast = (
  id: string,
  probabilities: number[],
  held: number | null,
  baseRates: number[] | null = null
) => ({
  id,
  anchor: { date: `2026-09-${id}`, price: 1000 },
  scenarios: probabilities.map((probability) => ({ probability })),
  baseRates,
  outcome: held === null ? null : { scenario: held },
});

test("a mark tells what a forecast gave the band that held, what history gave it, and whether it led", () => {
  expect(
    forecastMarks(
      [
        forecast("01", [20, 55, 25], 1, [0.3, 0.4, 0.3]),
        forecast("08", [20, 55, 25], 2),
        forecast("15", [50, 50], 0),
        forecast("22", [30, 70], null),
      ],
      10
    )
  ).toEqual([
    {
      id: "01",
      date: "2026-09-01",
      settled: { given: 0.55, history: 0.4, led: true },
    },
    {
      id: "08",
      date: "2026-09-08",
      settled: { given: 0.25, history: null, led: false },
    },
    {
      id: "15",
      date: "2026-09-15",
      settled: { given: 0.5, history: null, led: true },
    },
    { id: "22", date: "2026-09-22", settled: null },
  ]);
});

test("only the newest forecasts are marked, oldest first", () => {
  const marks = forecastMarks(
    [
      forecast("01", [60, 40], 0),
      forecast("08", [60, 40], 1),
      forecast("15", [60, 40], null),
    ],
    2
  );

  expect(marks.map(({ id }) => id)).toEqual(["08", "15"]);
});
