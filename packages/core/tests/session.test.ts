import { describe, expect, test } from "vite-plus/test";

import { Market } from "../src/market.ts";
import { Session, getSession } from "../src/session.ts";

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
