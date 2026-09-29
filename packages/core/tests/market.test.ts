import { expect, test } from "vite-plus/test";

import { Market, exchangeMidnight } from "../src/market.ts";

test.each([
  { market: Market.TW, date: "2026-09-29", utc: "2026-09-28T16:00:00Z" },
  { market: Market.US, date: "2026-07-01", utc: "2026-07-01T04:00:00Z" },
  { market: Market.US, date: "2026-01-15", utc: "2026-01-15T05:00:00Z" },
])("$market $date begins at $utc", ({ market, date, utc }) => {
  expect(exchangeMidnight(market, date)).toBe(Date.parse(utc) / 1000);
});
