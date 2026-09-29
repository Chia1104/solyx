import { TickMarkType } from "lightweight-charts";
import { expect, test } from "vite-plus/test";

import { exchangeTimeFormat, utcTimestamp } from "../src/time-format.ts";

// 2026-09-29 09:00 in Taipei.
const OPEN = utcTimestamp(Date.parse("2026-09-29T01:00:00Z") / 1000);

test("tick marks and crosshair read in the exchange's time zone", () => {
  const format = exchangeTimeFormat("Asia/Taipei", "en-US", true);

  expect(format.tickMarkFormatter(OPEN, TickMarkType.Time, "en-US")).toBe(
    "09:00"
  );
  expect(format.timeFormatter(OPEN)).toBe("09/29/2026, 09:00");
});

test("daily charts leave the time of day out of the crosshair", () => {
  const format = exchangeTimeFormat("Asia/Taipei", "zh-TW", false);

  expect(format.timeFormatter(OPEN)).toBe("2026/09/29");
});

test("the same instant reads differently in New York", () => {
  const format = exchangeTimeFormat("America/New_York", "en-US", true);

  expect(format.tickMarkFormatter(OPEN, TickMarkType.Time, "en-US")).toBe(
    "21:00"
  );
});
