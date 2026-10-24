import { expect, test, vi } from "vite-plus/test";

import { AppPlace } from "@solyx/agent/prompt";
import { ScreenKind } from "@solyx/api/agent";
import { ChartIndicator } from "@solyx/api/chart-indicator";
import { OverviewTab } from "@solyx/api/overview-tab";
import { SettingsSection } from "@solyx/api/settings-section";
import { Interval } from "@solyx/core/candles";
import { Market } from "@solyx/core/market";
import type { SymbolRef } from "@solyx/core/market";
import { StrategyTemplate } from "@solyx/core/strategy-templates";

import {
  messageContext,
  screenContext,
} from "../src/modules/agent/message-context.ts";
import type { MessageContextSources } from "../src/modules/agent/message-context.ts";

const listing = (market: Market, symbol: string): SymbolRef => ({
  market,
  symbol,
});

function sources(change: Partial<MessageContextSources> = {}) {
  return {
    focus: { symbol: listing(Market.TW, "2317"), name: "鴻海" },
    watchlist: () => [listing(Market.TW, "2330"), listing(Market.US, "NVDA")],
    holdings: vi.fn(async () => [listing(Market.TW, "2454")]),
    name: vi.fn(async (symbol: SymbolRef) =>
      symbol.symbol === "2330" ? "台積電" : undefined
    ),
    commands: vi.fn(async () => ["deep-analysis"]),
    ...change,
  } satisfies MessageContextSources;
}

test("codes resolve against the screen and the watchlist without reading the account", async () => {
  const from = sources();

  expect(
    await messageContext("/deep-analysis @2317 和 @2330、@nvda", from)
  ).toEqual({
    mentions: [
      { symbol: listing(Market.TW, "2317"), name: "鴻海" },
      { symbol: listing(Market.TW, "2330"), name: "台積電" },
      { symbol: listing(Market.US, "NVDA") },
    ],
    skill: "deep-analysis",
  });
  expect(from.holdings).not.toHaveBeenCalled();
  expect(from.name).not.toHaveBeenCalledWith(listing(Market.TW, "2317"));
});

test("a code only the account holds is read from it, and one nobody knows stays text", async () => {
  const from = sources();

  expect(await messageContext("@2454 跟 @9999", from)).toEqual({
    mentions: [{ symbol: listing(Market.TW, "2454") }],
    skill: undefined,
  });
  expect(from.holdings).toHaveBeenCalledOnce();
  expect(from.commands).not.toHaveBeenCalled();
});

test("a skill the user may not ask for is not named, and failing sources leave out only what they knew", async () => {
  expect(
    await messageContext(
      "/taiwan-market @2454 @2330",
      sources({
        holdings: () => Promise.reject(new Error("broker offline")),
        name: () => Promise.reject(new Error("no source")),
      })
    )
  ).toEqual({
    mentions: [{ symbol: listing(Market.TW, "2330") }],
    skill: undefined,
  });
});

// 10:00 in Taipei on 2026-10-26.
const NOW = new Date("2026-10-26T02:00:00Z");

test("the screen reaches the context as a listing with its chart, or as the page it shows", () => {
  expect(
    screenContext(
      {
        kind: ScreenKind.Listing,
        symbol: listing(Market.TW, "2317"),
        name: "鴻海",
        interval: Interval.FiveMinutes,
        indicators: [ChartIndicator.MovingAverage, ChartIndicator.ForeignFlow],
      },
      NOW
    )
  ).toEqual({
    focus: { symbol: listing(Market.TW, "2317"), name: "鴻海" },
    chart: {
      interval: Interval.FiveMinutes,
      indicators: ["short MAs", "foreign net buying"],
    },
  });
  expect(
    screenContext({ kind: ScreenKind.Overview, tab: OverviewTab.News }, NOW)
  ).toEqual({ place: AppPlace.Headlines });
  expect(
    screenContext(
      { kind: ScreenKind.Settings, section: SettingsSection.MarketData },
      NOW
    )
  ).toEqual({ settings: "market data" });
  expect(screenContext(null, NOW)).toEqual({});
});

test("the backtest the panel shows reaches the context as the call that runs it", () => {
  const { backtest } = screenContext(
    {
      kind: ScreenKind.Listing,
      symbol: listing(Market.TW, "2330"),
      interval: Interval.OneDay,
      indicators: [],
      backtest: {
        symbol: listing(Market.TW, "2330"),
        interval: Interval.OneDay,
        years: 5,
        strategy: {
          template: StrategyTemplate.MovingAverageCross,
          params: { fast: 5, slow: 20 },
          stopLoss: 0.08,
        },
        split: 0.75,
        capital: 1_000_000,
      },
    },
    NOW
  );

  expect(backtest).toBe(
    `backtest.rules(${JSON.stringify({
      symbol: listing(Market.TW, "2330"),
      interval: Interval.OneDay,
      since: "2021-10-26",
      strategy: {
        entry: { crossesAbove: [{ sma: 5 }, { sma: 20 }] },
        exit: { crossesBelow: [{ sma: 5 }, { sma: 20 }] },
        stopLoss: 0.08,
      },
      split: 0.75,
      capital: 1_000_000,
    })})`
  );
});
