import { expect, test } from "vite-plus/test";

import { BrokerMode } from "@solyx/core/broker";
import { ChangeKind } from "@solyx/core/changes";
import { DecisionMode } from "@solyx/core/council";
import { Market } from "@solyx/core/market";

import { formatContext } from "../src/prompt.ts";

test("the context tells the time on each exchange and on the user's own clock", () => {
  const context = formatContext({
    now: new Date("2026-10-07T11:27:00Z"),
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
