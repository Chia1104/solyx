import { expect, test } from "vite-plus/test";

import { Investor, balanceTrend, netBuying } from "../src/flows.ts";
import type { InvestorTrades } from "../src/flows.ts";

/** Consecutive sessions from 2026-09-01, one per net given. */
function sessions(investor: Investor, nets: number[]): InvestorTrades[] {
  return nets.map((net, index) => ({
    date: `2026-09-${String(index + 1).padStart(2, "0")}`,
    investor,
    bought: Math.max(net, 0) + 100,
    sold: Math.max(-net, 0) + 100,
  }));
}

test("sums each group's net buying over a session, a week and a month, in Investor's order", () => {
  const nets = Array.from({ length: 25 }, (_, index) => index + 1);

  expect(
    netBuying([
      ...sessions(Investor.InvestmentTrust, [-9, -5, -5, 3]),
      ...sessions(Investor.Foreign, nets),
    ])
  ).toEqual([
    {
      investor: Investor.Foreign,
      session: 25,
      week: 21 + 22 + 23 + 24 + 25,
      month: (6 + 25) * 10,
      streak: 25,
    },
    // The trust traded only the first four sessions, so it was flat in every one since.
    {
      investor: Investor.InvestmentTrust,
      session: 0,
      week: 0,
      month: 0,
      streak: 0,
    },
  ]);
  expect(
    netBuying(sessions(Investor.InvestmentTrust, [-9, -5, -5, 3]))
  ).toEqual([
    {
      investor: Investor.InvestmentTrust,
      session: 3,
      week: -16,
      month: -16,
      streak: 1,
    },
  ]);
});

test("a streak counts the sessions in a row on the newest one's side, selling below zero", () => {
  const [foreign] = netBuying(sessions(Investor.Foreign, [4, -1, 0, -2, -3]));

  expect(foreign.streak).toBe(-2);
});

test("a session's rows of one group add up", () => {
  const [foreign] = netBuying([
    { date: "2026-09-01", investor: Investor.Foreign, bought: 10, sold: 0 },
    { date: "2026-09-01", investor: Investor.Foreign, bought: 0, sold: 4 },
  ]);

  expect(foreign.session).toBe(6);
});

test("a balance moves against the session, week and month before, as far back as the series reaches", () => {
  const series = Array.from({ length: 8 }, (_, index) => ({
    date: `2026-09-0${index + 1}`,
    value: 100 + index * 10,
  }));

  expect(balanceTrend(series)).toEqual({
    date: "2026-09-08",
    value: 170,
    session: 10,
    week: 50,
    month: null,
  });
  expect(balanceTrend([])).toBeNull();
});
