import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { contentText } from "@earendil-works/pi-ai";
import type {
  ToolExecutionApi,
  ToolRegistration,
} from "@earendil-works/pi-durable";
import { expect, test, vi } from "vite-plus/test";

import { MacroFigure, MacroIndicator, MacroUnit } from "@solyx/core/macro";
import type { MacroSeries } from "@solyx/core/macro";
import { Market } from "@solyx/core/market";

import { createMacroTools } from "../src/macro.ts";
import type { MacroToolsOptions } from "../src/macro.ts";
import { AgentToolName } from "../src/wire.ts";

// 2026-10-12 10:00 in Taipei.
const NOW = new Date("2026-10-12T02:00:00Z");

const EXPORTS: MacroSeries = {
  market: Market.TW,
  indicator: MacroIndicator.Trade,
  figure: MacroFigure.Exports,
  unit: MacroUnit.UsdMillions,
  observations: [
    { period: "2025-09", value: 40000, forecast: null },
    { period: "2026-08", value: 50000.126, forecast: null },
    { period: "2026-09", value: 52000, forecast: null },
  ],
  expected: null,
};

const SIGNAL: MacroSeries = {
  market: Market.TW,
  indicator: MacroIndicator.BusinessSignal,
  figure: MacroFigure.BusinessSignal,
  unit: MacroUnit.Points,
  observations: [{ period: "2026-08", value: 41, forecast: null }],
  expected: null,
};

function setup() {
  const series = vi.fn<MacroToolsOptions["series"]>(async (market) =>
    market === Market.TW ? [EXPORTS, SIGNAL] : []
  );

  const [tool] =
    createMacroTools({ series, yields: async () => [], now: () => NOW })
      .tools ?? [];

  const run = async (params: Parameters<ToolRegistration["execute"]>[0]) => {
    // SAFETY: get_macro never uses its call's api.
    const api = {} as ToolExecutionApi;
    const result = await tool.execute(params, api, BACKGROUND_CONTEXT);

    return { text: contentText(result.output ?? []), details: result.details };
  };

  return { tool, run, series };
}

test("reads each figure's periods oldest first, with the growth on the year the app computed", async () => {
  const { tool, run, series } = setup();

  expect(tool.name).toBe(AgentToolName.GetMacro);

  const { text, details } = await run({});

  expect(series).toHaveBeenCalledExactlyOnceWith(Market.TW);
  expect(text.split("\n")).toEqual([
    "TW economic figures as_of 2026-10-12 10:00, each figure's last 13 periods out",
    "exports, of trade, in USD millions:",
    "period,value,on the year,expected",
    "2025-09,40000,n/a,n/a",
    "2026-08,50000.13,n/a,n/a",
    "2026-09,52000,+30.00%,n/a",
    "business signal, of business signal, in points:",
    "period,value,on the year,expected",
    "2026-08,41,n/a,n/a",
  ]);
  expect(details).toEqual({ market: Market.TW });
});

test("a market no source covers says so, which says nothing of its economy", async () => {
  const { run } = setup();

  const { text } = await run({ market: Market.US });

  expect(text).toBe(
    "No source has US's economic figures yet. That says nothing of the economy."
  );
});

test("a US figure reads with what the market expected of each period and of the next", async () => {
  const prices: MacroSeries = {
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

  const rate: MacroSeries = {
    market: Market.US,
    indicator: MacroIndicator.PolicyRate,
    figure: MacroFigure.PolicyRate,
    unit: MacroUnit.Rate,
    observations: [{ period: "2026-10-28", value: 3.875, forecast: 3.875 }],
    expected: null,
  };

  const [tool] =
    createMacroTools({
      series: async () => [prices, rate],
      yields: async () => [
        {
          date: "2026-10-27",
          yields: { "3m": 4.22, "2y": 4.7, "10y": 4.99, "30y": null },
        },
        {
          date: "2026-10-28",
          yields: { "3m": 4.18, "2y": 5.1, "10y": 5.05, "30y": 5.37 },
        },
      ],
      now: () => NOW,
    }).tools ?? [];

  // SAFETY: get_macro never uses its call's api.
  const api = {} as ToolExecutionApi;

  const result = await tool.execute(
    { market: Market.US },
    api,
    BACKGROUND_CONTEXT
  );

  expect(
    contentText(result.output ?? [])
      .split("\n")
      .slice(1)
  ).toEqual([
    "consumer prices, of consumer prices, in percent growth on the year:",
    "period,value,on the year,expected",
    "2026-08,3.4,+3.40%,n/a",
    "2026-09,3.7,+3.70%,3.6",
    "next, 2026-10, not out yet: 3.8% on the year expected",
    "policy rate, of policy rate, in percent, a level:",
    "period,value,on the year,expected",
    "2026-10-28,3.875,n/a,3.875",
    "US Treasury par yields at each day's close, in percent, oldest first; the last column is ten years' less two years':",
    "date,3m,2y,10y,30y,10y less 2y",
    "2026-10-27,4.22,4.7,4.99,n/a,+0.29",
    "2026-10-28,4.18,5.1,5.05,5.37,-0.05",
  ]);
});
