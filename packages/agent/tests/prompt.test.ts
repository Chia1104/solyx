import { expect, test } from "vite-plus/test";

import { BrokerMode } from "@solyx/core/broker";
import { Interval } from "@solyx/core/candles";
import { ChangeKind } from "@solyx/core/changes";
import { DecisionMode } from "@solyx/core/council";
import { Market } from "@solyx/core/market";
import { Session } from "@solyx/core/session";

import { AppPlace, formatContext } from "../src/prompt.ts";
import type { TurnContext } from "../src/prompt.ts";

test("the context tells the time on each exchange with the session the host says it is in, and on the user's own clock", () => {
  const context = formatContext({
    now: new Date("2026-10-07T11:27:00Z"),
    sessions: { [Market.TW]: Session.Closed, [Market.US]: Session.Pre },
    brokerMode: BrokerMode.Paper,
    locale: "zh-TW",
    timeZone: "Europe/London",
    decisionMode: DecisionMode.Single,
  });

  expect(context.split("\n")).toEqual([
    "time: Taipei 2026-10-07 19:27 (TW closed), New York 2026-10-07 07:27 (US pre)",
    "clock: 2026-10-07 12:27 Europe/London",
    "account: paper",
    "language: zh-TW",
  ]);
});

test("the context names the listing on screen, those the user named and the skill they asked for", () => {
  const context = formatContext({
    now: new Date("2026-10-07T11:27:00Z"),
    sessions: { [Market.TW]: Session.Closed, [Market.US]: Session.Pre },
    brokerMode: BrokerMode.Paper,
    focus: { symbol: { market: Market.TW, symbol: "2317" }, name: "鴻海" },
    mentions: [
      { symbol: { market: Market.TW, symbol: "2330" }, name: "台積電" },
      { symbol: { market: Market.US, symbol: "NVDA" } },
    ],
    skill: "deep-analysis",
    locale: "zh-TW",
    timeZone: "Asia/Taipei",
    decisionMode: DecisionMode.Single,
  });

  expect(context.split("\n").slice(4)).toEqual([
    "viewing: TW 2317 (鴻海)",
    "mentions: TW 2330 (台積電), US NVDA",
    "skill: deep-analysis",
  ]);
});

test("the context says when a scheduled task sent the message in the user's place", () => {
  const context = formatContext({
    now: new Date("2026-10-07T11:27:00Z"),
    sessions: { [Market.TW]: Session.Closed, [Market.US]: Session.Pre },
    brokerMode: BrokerMode.Paper,
    skill: "watchlist-upkeep",
    locale: "zh-TW",
    timeZone: "Asia/Taipei",
    decisionMode: DecisionMode.Single,
    scheduled: "Morning brief",
    changes: [
      {
        kind: ChangeKind.EventPassed,
        symbol: { market: Market.TW, symbol: "2330" },
        date: "2026-10-06",
        label: "Earnings call",
      },
      {
        kind: ChangeKind.SignpostMet,
        theme: "Outbreak",
        signpost: "A port suspends operations.",
      },
    ],
  });

  expect(context.split("\n").slice(4)).toEqual([
    "skill: watchlist-upkeep",
    "scheduled: Morning brief",
    'changed: TW 2330: the event "Earnings call" of 2026-10-06 has passed',
    'changed: theme "Outbreak": news may state the signpost "A port suspends operations."',
  ]);
});

test("the context says what the user had on screen: a listing's chart, or a page of the app", () => {
  const viewing = (screen: Partial<TurnContext>) =>
    formatContext({
      now: new Date("2026-10-07T11:27:00Z"),
      sessions: { [Market.TW]: Session.Closed, [Market.US]: Session.Pre },
      brokerMode: BrokerMode.Paper,
      locale: "zh-TW",
      timeZone: "Asia/Taipei",
      decisionMode: DecisionMode.Single,
      ...screen,
    })
      .split("\n")
      .filter((line) => line.startsWith("viewing:"));

  const focus = { symbol: { market: Market.TW, symbol: "2317" }, name: "鴻海" };

  expect(
    viewing({
      focus,
      chart: {
        interval: Interval.FiveMinutes,
        indicators: ["short MAs", "KD"],
      },
    })
  ).toEqual(["viewing: TW 2317 (鴻海) on a 5m chart with short MAs, KD"]);
  expect(
    viewing({ focus, chart: { interval: Interval.OneDay, indicators: [] } })
  ).toEqual(["viewing: TW 2317 (鴻海) on a 1d chart"]);
  expect(viewing({ place: AppPlace.Headlines })).toEqual([
    "viewing: the overview, the headlines",
  ]);
  expect(viewing({ place: AppPlace.Market, placeMarket: Market.US })).toEqual([
    "viewing: the overview, the market's sectors and flows, kept to US",
  ]);
  expect(viewing({ settings: "market data" })).toEqual([
    "viewing: the settings, market data",
  ]);
  expect(viewing({ strategies: {} })).toEqual(["viewing: the strategies page"]);
  expect(viewing({ strategies: { name: "close-mean" } })).toEqual([
    "viewing: the page of the strategy close-mean",
  ]);
  expect(viewing({})).toEqual([]);
});
