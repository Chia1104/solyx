import { sumBy } from "es-toolkit";
import { describe, expect, test } from "vite-plus/test";

import type { Candle } from "../src/candles.ts";
import { sma } from "../src/indicators.ts";
import {
  PROFILE_SESSIONS,
  ZoneKind,
  breaksBelow,
  pointOfControl,
  supportZones,
  volumeProfile,
  yearRange,
} from "../src/levels.ts";

function bar(low: number, high: number, close: number, volume = 1): Candle {
  return { time: 0, open: close, high, low, close, volume };
}

/** Daily bars closing from `from` by `step` a session, each a point either side of its close. */
function trend(sessions: number, from: number, step: number): Candle[] {
  return Array.from({ length: sessions }, (_, i) => {
    const close = from + i * step;

    return bar(close - 1, close + 1, close);
  });
}

test("yearRange reads only the last 240 bars", () => {
  const daily = [bar(1, 1000, 500), ...trend(240, 100, 1)];

  expect(yearRange(daily)).toEqual({ low: 99, high: 340 });
  expect(yearRange([])).toBeNull();
});

describe("volumeProfile", () => {
  test("keeps every share, in contiguous slices from the lowest low to the highest high", () => {
    const daily = trend(PROFILE_SESSIONS + 10, 100, 1);
    const profile = volumeProfile(daily);
    const read = daily.slice(-PROFILE_SESSIONS);

    expect(sumBy(profile, (slice) => slice.volume)).toBeCloseTo(
      sumBy(read, (candle) => candle.volume)
    );
    expect(profile[0].low).toBe(Math.min(...read.map((c) => c.low)));
    expect(profile.at(-1)?.high).toBe(Math.max(...read.map((c) => c.high)));

    for (let i = 1; i < profile.length; i++) {
      expect(profile[i].low).toBeCloseTo(profile[i - 1].high);
    }
  });

  test("puts a bar that traded at one price in the slice holding it", () => {
    const profile = volumeProfile([
      bar(0, 30, 15, 30),
      bar(25.5, 25.5, 25.5, 70),
    ]);

    expect(pointOfControl(profile)).toEqual({ low: 25, high: 26, volume: 71 });
  });
});

describe("supportZones", () => {
  test("rings the quarter and half-year lines and the densest trading under the close", () => {
    const daily = trend(200, 100, 1);
    const closes = daily.map((candle) => candle.close);
    const quarter = sma(closes, 60).at(-1) ?? 0;
    const halfYear = sma(closes, 120).at(-1) ?? 0;

    const zones = supportZones(daily);
    const zone = (kind: ZoneKind) => zones.find((each) => each.kind === kind);

    expect(zones).toHaveLength(3);
    expect(zones.map((each) => each.high)).toEqual(
      zones.map((each) => each.high).toSorted((a, b) => b - a)
    );
    expect(zone(ZoneKind.QuarterLine)?.low).toBeCloseTo(quarter * 0.98);
    expect(zone(ZoneKind.QuarterLine)?.high).toBeCloseTo(quarter * 1.02);
    expect(zone(ZoneKind.HalfYearLine)?.low).toBeCloseTo(halfYear * 0.97);
    expect(zone(ZoneKind.HalfYearLine)?.high).toBeCloseTo(halfYear * 1.03);
    expect(zone(ZoneKind.Volume)?.high).toBeLessThanOrEqual(closes.at(-1) ?? 0);
  });

  test("leaves out a line the close is under", () => {
    const daily = trend(200, 300, -1);

    expect(
      supportZones(daily).some((zone) => zone.kind !== ZoneKind.Volume)
    ).toBe(false);
  });
});

test("breaksBelow marks a close falling under the line from at or above it", () => {
  expect(
    breaksBelow([10, 11, 9, 8, 12, 9], [null, 10, 10, 10, 10, 10])
  ).toEqual([2, 5]);
});
