import { expect, test } from "vite-plus/test";

import {
  Market,
  exchangeDate,
  exchangeMidnight,
  exchangeTime,
  shiftDate,
} from "../src/market.ts";

test.each([
  { market: Market.TW, date: "2026-09-29", utc: "2026-09-28T16:00:00Z" },
  { market: Market.US, date: "2026-07-01", utc: "2026-07-01T04:00:00Z" },
  { market: Market.US, date: "2026-01-15", utc: "2026-01-15T05:00:00Z" },
  { market: Market.US, date: "2026-03-08", utc: "2026-03-08T05:00:00Z" },
  { market: Market.US, date: "2026-11-01", utc: "2026-11-01T04:00:00Z" },
])("$market $date begins at $utc", ({ market, date, utc }) => {
  expect(exchangeMidnight(market, date)).toBe(Date.parse(utc) / 1000);
});

test.each([
  { market: Market.TW, at: "2026-09-28T16:30:00Z", time: "2026-09-29 00:30" },
  { market: Market.US, at: "2026-09-28T03:59:59Z", time: "2026-09-27 23:59" },
])("$at reads $time on the $market clock", ({ market, at, time }) => {
  expect(exchangeTime(market, new Date(at))).toBe(time);
  expect(exchangeDate(market, new Date(at))).toBe(time.slice(0, 10));
});

test.each([
  { date: "2024-02-28", days: 1, shifted: "2024-02-29" },
  { date: "2024-03-01", days: -1, shifted: "2024-02-29" },
  { date: "2026-12-31", days: 1, shifted: "2027-01-01" },
])("$date moved by $days days is $shifted", ({ date, days, shifted }) => {
  expect(shiftDate(date, days)).toBe(shifted);
});
