import { expect, test } from "vite-plus/test";

import { BrokerMode } from "@solyx/core/broker";
import { DecisionMode } from "@solyx/core/council";

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
