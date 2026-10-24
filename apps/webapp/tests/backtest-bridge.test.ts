import { expect, test } from "vite-plus/test";

import type { RuleStrategy } from "@solyx/core/backtest";
import { Interval } from "@solyx/core/candles";
import { Market } from "@solyx/core/market";

import { panelSetup } from "../src/modules/backtests/ran-backtest.ts";

const TSMC = { market: Market.TW, symbol: "2330" };

// 10:00 in Taipei on 2026-10-26.
const NOW = new Date("2026-10-26T02:00:00Z");

const strategy: RuleStrategy = {
  entry: { above: [{ price: "close" }, { value: 100 }] },
  exit: { below: [{ price: "close" }, { sma: 20 }] },
};

test("an agent's backtest opens with its rules, its span and split the nearest the panel offers", () => {
  expect(
    panelSetup(
      {
        symbol: TSMC,
        interval: Interval.OneDay,
        since: "2018-01-02",
        strategy,
        split: { day: "2023-11-01" },
        capital: 2_000_000,
      },
      NOW
    )
  ).toEqual({
    symbol: TSMC,
    interval: Interval.OneDay,
    // Eight years and ten months back read as ten, and a split some two thirds in as two thirds.
    years: 10,
    strategy: { rules: strategy },
    split: 2 / 3,
    capital: 2_000_000,
  });
});

test("one with no first day reads the app's own history, and a share splits where it said", () => {
  expect(
    panelSetup(
      {
        symbol: TSMC,
        interval: Interval.OneDay,
        strategy,
        split: { share: 0.74 },
      },
      NOW
    )
  ).toMatchObject({ years: 1, split: 0.75 });
});
