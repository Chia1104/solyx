import { describe, expect, test } from "vite-plus/test";

import { Market } from "../src/market.ts";
import {
  Session,
  getSession,
  listedTradingDays,
  nextTradingDay,
  sessionDayAt,
  sessionsBetween,
  weekdays,
} from "../src/session.ts";

describe("TW sessions (Asia/Taipei)", () => {
  test.each([
    ["2026-09-29T00:45:00Z", Session.Pre],
    ["2026-09-29T01:00:00Z", Session.Regular],
    ["2026-09-29T05:29:00Z", Session.Regular],
    ["2026-09-29T05:45:00Z", Session.Closed],
    ["2026-09-29T06:10:00Z", Session.Post],
    ["2026-10-03T01:30:00Z", Session.Closed],
  ])("%s is %s", (iso, session) => {
    expect(getSession(Market.TW, new Date(iso))).toBe(session);
  });
});

test("a market is closed all day on a day its exchange does not trade", () => {
  // Friday 2026-10-09 is a holiday in Taipei.
  const trades = listedTradingDays("2026-10-01", ["2026-10-08", "2026-10-12"]);
  const midSession = (date: string) => new Date(`${date}T10:00:00+08:00`);

  expect(getSession(Market.TW, midSession("2026-10-08"), trades)).toBe(
    Session.Regular
  );
  expect(getSession(Market.TW, midSession("2026-10-09"), trades)).toBe(
    Session.Closed
  );
  // Without the exchange's days every weekday trades.
  expect(getSession(Market.TW, midSession("2026-10-09"))).toBe(Session.Regular);
});

describe("US sessions follow New York daylight saving", () => {
  test.each([
    ["2026-09-29T13:29:00Z", Session.Pre],
    ["2026-09-29T13:30:00Z", Session.Regular],
    ["2026-12-01T14:00:00Z", Session.Pre],
    ["2026-12-01T14:30:00Z", Session.Regular],
    ["2026-12-01T21:00:00Z", Session.Post],
    ["2026-12-02T01:00:00Z", Session.Closed],
  ])("%s is %s", (iso, session) => {
    expect(getSession(Market.US, new Date(iso))).toBe(session);
  });
});

describe("sessions between two times count each one traded, the one under way included", () => {
  test.each([
    // Friday evening to Saturday morning in Taipei: nothing traded.
    [Market.TW, "2026-10-02T12:00:00Z", "2026-10-03T02:00:00Z", 0],
    // Friday evening to Monday mid-session.
    [Market.TW, "2026-10-02T12:00:00Z", "2026-10-05T02:00:00Z", 1],
    // Monday before the open, to just before it.
    [Market.TW, "2026-10-05T00:00:00Z", "2026-10-05T00:30:00Z", 0],
    // Within one Wednesday session.
    [Market.TW, "2026-09-30T02:00:00Z", "2026-09-30T03:00:00Z", 1],
    // Tuesday after the close to Friday after the close.
    [Market.TW, "2026-09-29T06:00:00Z", "2026-10-02T06:00:00Z", 3],
    // Friday after New York's close to Monday mid-session.
    [Market.US, "2026-10-02T21:00:00Z", "2026-10-05T14:00:00Z", 1],
  ])("%s %s to %s: %i", (market, from, to, sessions) => {
    expect(
      sessionsBetween(market, new Date(from), new Date(to), weekdays)
    ).toBe(sessions);
  });
});

describe("an exchange's listed days", () => {
  // Monday 2026-09-28 is a holiday; the exchange has set its days through Friday 2026-10-02.
  const trades = listedTradingDays("2026-09-24", [
    "2026-09-24",
    "2026-09-25",
    "2026-09-29",
    "2026-09-30",
    "2026-10-01",
    "2026-10-02",
  ]);

  test.each([
    ["2026-09-25", true],
    ["2026-09-28", false],
    ["2026-09-26", false],
    // Before and after the span, every weekday trades.
    ["2026-09-23", true],
    ["2026-10-05", true],
    ["2026-10-03", false],
  ])("%s trades: %s", (date, expected) => {
    expect(trades(date)).toBe(expected);
  });

  test("leave a holiday out of the sessions counted", () => {
    // Friday after the close to Wednesday after the close: Tuesday and Wednesday traded.
    expect(
      sessionsBetween(
        Market.TW,
        new Date("2026-09-25T06:00:00Z"),
        new Date("2026-09-30T06:00:00Z"),
        trades
      )
    ).toBe(2);
  });

  test("none listed leaves every weekday trading", () => {
    expect(listedTradingDays("2026-09-24", [])("2026-09-28")).toBe(true);
  });
});

describe("the session an order goes to", () => {
  // Friday 2026-10-09 is a holiday in Taipei.
  const trades = listedTradingDays("2026-10-01", [
    "2026-10-07",
    "2026-10-08",
    "2026-10-12",
  ]);

  test.each([
    // Before the close it is the session of the day.
    ["2026-10-08T08:00:00+08:00", "2026-10-08"],
    ["2026-10-08T13:29:00+08:00", "2026-10-08"],
    // From the close on it is the next day the market trades, over the holiday and the weekend.
    ["2026-10-08T13:30:00+08:00", "2026-10-12"],
    ["2026-10-09T10:00:00+08:00", "2026-10-12"],
    ["2026-10-11T22:00:00+08:00", "2026-10-12"],
  ])("at %s is %s's", (iso, day) => {
    expect(sessionDayAt(Market.TW, new Date(iso), trades)).toBe(day);
  });

  test("the next trading day skips the days the market does not trade", () => {
    expect(nextTradingDay("2026-10-08", trades)).toBe("2026-10-12");
    expect(nextTradingDay("2026-10-08", weekdays)).toBe("2026-10-09");
  });
});
