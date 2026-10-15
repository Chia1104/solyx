import { expect, test } from "vite-plus/test";

import { EventTiming } from "@solyx/core/calendar";
import { Market, symbolKey } from "@solyx/core/market";
import type { SymbolRef } from "@solyx/core/market";
import { OrderType, Side } from "@solyx/core/order";
import { ProposalSource, ProposalStatus } from "@solyx/core/order-desk";
import type { TradeProposal } from "@solyx/core/order-desk";
import { ReportStance } from "@solyx/core/report";
import type { Report } from "@solyx/core/report";
import type { ReportBacklog } from "@solyx/core/research";

import { createInbox } from "../src/main/modules/inbox/inbox.ts";

const TSMC = { market: Market.TW, symbol: "2330" };

const MEDIATEK = { market: Market.TW, symbol: "2454" };

const UMC = { market: Market.TW, symbol: "2303" };

const proposal = (
  id: string,
  status: TradeProposal["status"]
): TradeProposal => ({
  id,
  order: {
    instrument: TSMC,
    side: Side.Buy,
    type: OrderType.Limit,
    limitPrice: 1_000,
    quantity: 1_000,
  },
  source: ProposalSource.Agent,
  rationale: "",
  createdAt: 0,
  status,
  violations: [],
});

const report = (symbol: SymbolRef): Report => ({
  symbol,
  revision: 1,
  revisedAt: 0,
  financialsThrough: null,
  stance: ReportStance.Bullish,
  thesis: "",
  drivers: [],
  risks: [],
  falsifiers: [],
  valuation: null,
  events: [],
  sections: {},
});

test("the inbox lists proposals that wait, calls that wait and reports with something to take in", async () => {
  const backlogs = new Map<string, ReportBacklog>([
    [
      symbolKey(TSMC),
      {
        report: report(TSMC),
        signals: [],
        passedEvents: [
          {
            date: "2026-10-16",
            label: "Earnings call",
            timing: EventTiming.Set,
            source: "IR",
            quote: "October 16",
            support: null,
          },
        ],
      },
    ],
    // A report with nothing to take in waits for nothing.
    [
      symbolKey(MEDIATEK),
      { report: report(MEDIATEK), signals: [], passedEvents: [] },
    ],
  ]);

  const inbox = createInbox({
    desk: {
      list: () => [
        proposal("waits", ProposalStatus.AwaitingConfirmation),
        proposal("done", ProposalStatus.Submitted),
        proposal("refused", ProposalStatus.Rejected),
      ],
    },
    approvals: async () => [{ sessionId: "s-1", title: "Rebalance" }],
    followed: async () => [TSMC, MEDIATEK, UMC],
    research: { backlog: (symbol) => backlogs.get(symbolKey(symbol)) ?? null },
  });

  const listed = await inbox.list();

  expect(listed.proposals.map(({ id }) => id)).toEqual(["waits"]);
  expect(listed.approvals).toEqual([{ sessionId: "s-1", title: "Rebalance" }]);
  expect(listed.reports.map(({ report }) => report.symbol)).toEqual([TSMC]);
});
