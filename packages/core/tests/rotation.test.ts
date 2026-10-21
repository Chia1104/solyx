import { describe, expect, test } from "vite-plus/test";

import type { Candle } from "../src/candles.ts";
import { Market } from "../src/market.ts";
import {
  Quadrant,
  ROTATION_PERIODS,
  ROTATION_TRAIL,
  RotationInterval,
  lastTransition,
  quadrantOf,
  readEveryRotation,
  readRotation,
  readRotations,
  rollingZ,
  rotation,
  rotationSeries,
  rotationTrail,
} from "../src/rotation.ts";

const taipei = (date: string) => Date.parse(`${date}T00:00:00+08:00`) / 1000;

/** Daily bars from 2026-01-05 on, one per weekday, closing at each of `closes`. */
function bars(closes: readonly number[]): Candle[] {
  const day = new Date("2026-01-05T00:00:00Z");

  return closes.map((close) => {
    while (day.getUTCDay() % 6 === 0) day.setUTCDate(day.getUTCDate() + 1);

    const time = taipei(day.toISOString().slice(0, 10));

    day.setUTCDate(day.getUTCDate() + 1);

    return { time, open: close, high: close, low: close, close, volume: 0 };
  });
}

describe("rollingZ", () => {
  test("scores the last value of each window in population standard deviations", () => {
    const line = rollingZ([1, 2, 3, 4, 5], 3);

    expect(line.slice(0, 2)).toEqual([null, null]);
    // The last of 1, 2, 3 is one deviation (sqrt(2/3)) above their mean of 2.
    expect(line[2]).toBeCloseTo(1 / Math.sqrt(2 / 3));
    expect(line[3]).toBeCloseTo(1 / Math.sqrt(2 / 3));
  });

  test("is null while the window holds a null or does not vary", () => {
    expect(rollingZ([1, null, 3, 4, 5], 3)).toEqual([
      null,
      null,
      null,
      null,
      1 / Math.sqrt(2 / 3),
    ]);
    expect(rollingZ([2, 2, 2], 3)).toEqual([null, null, null]);
    expect(rollingZ([1e9, 1e9 + 1e-7, 1e9 + 2e-7], 3)).toEqual([
      null,
      null,
      null,
    ]);
  });

  test("scores a window of large values as it would the same window shifted to zero", () => {
    const shifted = rollingZ([1e6 + 1, 1e6 + 2, 1e6 + 4, 1e6 + 8], 4)[3];

    expect(shifted).toBeCloseTo(rollingZ([1, 2, 4, 8], 4)[3]!, 10);
  });
});

describe("rotation", () => {
  test("takes twice the period to give both coordinates", () => {
    const values = [1, 2, 3, 5, 8, 13, 21, 34, 55, 89];
    const benchmark = values.map(() => 1);
    const { level, momentum } = rotation(values, benchmark, 3);

    expect(level.slice(0, 2)).toEqual([null, null]);
    expect(level[2]).not.toBeNull();
    expect(momentum.slice(0, 5)).toEqual([null, null, null, null, null]);
    expect(momentum[5]).not.toBeNull();
  });

  test("reads the ratio, so a listing that keeps pace with its benchmark does not move", () => {
    const values = [10, 11, 12, 13, 14, 15, 16, 17];
    const { level, momentum } = rotation(values, values, 3);

    expect(level.every((each) => each === null)).toBe(true);
    expect(momentum.every((each) => each === null)).toBe(true);
  });

  test("a bar the benchmark lacks breaks every window it falls in", () => {
    const values = [1, 2, 4, 8, 16, 32, 64, 128];
    const benchmark: (number | null)[] = values.map(() => 1);

    benchmark[3] = null;

    const { level } = rotation(values, benchmark, 3);

    expect(level[2]).not.toBeNull();
    expect(level.slice(3, 6)).toEqual([null, null, null]);
    expect(level[6]).not.toBeNull();
  });
});

describe("quadrants", () => {
  test("meet at the origin, which counts as leading", () => {
    expect(quadrantOf(0, 0)).toBe(Quadrant.Leading);
    expect(quadrantOf(1, -1)).toBe(Quadrant.Weakening);
    expect(quadrantOf(-1, -1)).toBe(Quadrant.Lagging);
    expect(quadrantOf(-1, 1)).toBe(Quadrant.Improving);
  });

  test("rotationTrail keeps the last bars with both coordinates, oldest first", () => {
    const trail = rotationTrail(
      { level: [null, 1, 2, 3, 4], momentum: [null, null, -1, null, 1] },
      5
    );

    expect(trail).toEqual([
      { index: 2, level: 2, momentum: -1 },
      { index: 4, level: 4, momentum: 1 },
    ]);
    expect(rotationTrail({ level: [1, 2], momentum: [1, 1] }, 1)).toEqual([
      { index: 1, level: 2, momentum: 1 },
    ]);
  });

  test("lastTransition names the last crossing between consecutive stops", () => {
    const stops = [
      { index: 0, level: -1, momentum: -1 },
      { index: 1, level: -1, momentum: 1 },
      { index: 2, level: 1, momentum: 1 },
      { index: 3, level: 2, momentum: 1 },
    ];

    expect(lastTransition(stops)).toEqual({
      from: Quadrant.Improving,
      to: Quadrant.Leading,
      index: 2,
    });
    expect(lastTransition(stops.slice(2))).toBeNull();
    expect(lastTransition([])).toBeNull();
  });
});

describe("readRotation", () => {
  // A listing that gains on a flat benchmark faster and faster, then slips a little each session.
  const closes = [
    100, 100.5, 101, 101.5, 102, 103, 104, 105.5, 107, 109, 111, 114, 117, 121,
    125, 124.5, 124, 123.5, 123, 122.5,
  ];

  const TODAY = "2026-02-02";
  const listing = bars(closes);
  const benchmark = bars(closes.map(() => 1000));

  const daily = (candles: Candle[]) =>
    rotationSeries(Market.TW, RotationInterval.Daily, candles, TODAY);

  test("dates each stop and names the newest quadrant and the last crossing", () => {
    const reading = readRotation(daily(listing), daily(benchmark), 4);

    expect(reading.interval).toBe(RotationInterval.Daily);
    expect(reading.period).toBe(4);
    expect(reading.trail).toHaveLength(ROTATION_TRAIL);
    expect(reading.trail[0]?.date).toBe("2026-01-19");
    expect(reading.trail.at(-1)?.date).toBe("2026-01-30");
    // The slip holds the ratio at its window's floor, but the level's fall has stopped, which
    // stands above the falls before it: improving, as the graph reads it, not rising.
    expect(reading.quadrant).toBe(Quadrant.Improving);
    expect(reading.transition).toEqual({
      from: Quadrant.Lagging,
      to: Quadrant.Improving,
      date: "2026-01-29",
    });
  });

  test("gives an empty trail while the bars are too few", () => {
    const reading = readRotation(
      daily(listing.slice(0, 7)),
      daily(benchmark),
      4
    );

    expect(reading).toEqual({
      interval: RotationInterval.Daily,
      period: 4,
      trail: [],
      quadrant: null,
      transition: null,
    });
  });

  test("matches the benchmark's bars by time rather than by position", () => {
    const whole = readRotation(daily(listing), daily(benchmark), 4);
    const offset = readRotation(daily(listing), daily(benchmark.slice(2)), 4);

    expect(offset.trail).toEqual(whole.trail);
  });

  test("readRotations reads every period of the series' interval", () => {
    const readings = readRotations(daily(listing), daily(benchmark));

    expect(readings.map(({ period }) => period)).toEqual(
      ROTATION_PERIODS[RotationInterval.Daily]
    );
    expect(readings.every(({ trail }) => trail.length === 0)).toBe(true);
  });

  test("readEveryRotation reads both intervals", () => {
    const readings = readEveryRotation(Market.TW, listing, benchmark, TODAY);

    expect(
      readings.map(({ interval, period }) => `${interval}:${period}`)
    ).toEqual(["1d:20", "1d:60", "1d:120", "1w:13", "1w:26", "1w:52"]);
  });
});

describe("rotationSeries", () => {
  // Four weeks of sessions from Monday 2026-01-05, the fourth missing its Monday, then a Monday.
  const closes = Array.from({ length: 21 }, (_, i) => 100 + i);
  const daily = bars(closes).filter((_, i) => i !== 15);

  test("merges sessions into closed weeks dated by their last session, matched by their first day", () => {
    const weekly = rotationSeries(
      Market.TW,
      RotationInterval.Weekly,
      daily,
      "2026-02-03"
    );

    expect(weekly.keys).toEqual([
      "2026-01-05",
      "2026-01-12",
      "2026-01-19",
      "2026-01-26",
    ]);
    expect(weekly.dates).toEqual([
      "2026-01-09",
      "2026-01-16",
      "2026-01-23",
      "2026-01-30",
    ]);
    expect(weekly.bars.map(({ close }) => close)).toEqual([104, 109, 114, 119]);
    // The fourth week opened on its Tuesday, which is no reason to match it apart from the others.
    expect(weekly.bars[3].open).toBe(116);
  });

  test("leaves out the week under way", () => {
    const weekly = rotationSeries(
      Market.TW,
      RotationInterval.Weekly,
      daily.slice(0, -1),
      "2026-01-28"
    );

    expect(weekly.keys).toEqual(["2026-01-05", "2026-01-12", "2026-01-19"]);
  });

  test("keeps sessions as they are, keyed by their time", () => {
    const series = rotationSeries(
      Market.TW,
      RotationInterval.Daily,
      daily.slice(0, 2),
      "2026-02-03"
    );

    expect(series.keys).toEqual(
      daily.slice(0, 2).map(({ time }) => String(time))
    );
    expect(series.dates).toEqual(["2026-01-05", "2026-01-06"]);
  });
});
