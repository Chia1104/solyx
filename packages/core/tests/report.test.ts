import { expect, test } from "vite-plus/test";

import { Market } from "../src/market.ts";
import {
  ReportSection,
  ReportStance,
  ReportViolationCode,
  reportDraftSchema,
  reviseReport,
} from "../src/report.ts";
import type { Report } from "../src/report.ts";

const TSMC = { market: Market.TW, symbol: "2330" };

const AT = 1_790_000_000_000;

function first(): Report {
  const revision = reviseReport(
    null,
    {
      symbol: TSMC,
      stance: ReportStance.Bullish,
      thesis: "Advanced nodes stay sold out.",
      falsifiers: ["A large customer moves orders to another foundry."],
      valuation: { low: 900, high: 1100, basis: "20 to 24 times earnings" },
      sections: { [ReportSection.Business]: "Foundry." },
    },
    AT
  );

  if (!revision.ok) throw new Error("The first revision was refused");

  return revision.report;
}

test("a listing's first revision needs a stance and a thesis", () => {
  expect(reviseReport(null, { symbol: TSMC }, AT)).toEqual({
    ok: false,
    violations: [
      { code: ReportViolationCode.MissingStance },
      { code: ReportViolationCode.MissingThesis },
    ],
  });
});

test("a revision changes what it names and keeps the rest, each section with its own age", () => {
  const revision = reviseReport(
    first(),
    {
      symbol: TSMC,
      stance: ReportStance.Neutral,
      sections: { [ReportSection.Risks]: "Export controls." },
    },
    AT + 5
  );

  expect(revision).toMatchObject({
    ok: true,
    report: {
      revision: 2,
      revisedAt: AT + 5,
      stance: ReportStance.Neutral,
      thesis: "Advanced nodes stay sold out.",
      falsifiers: ["A large customer moves orders to another foundry."],
      valuation: { low: 900, high: 1100 },
      sections: {
        [ReportSection.Business]: { text: "Foundry.", revisedAt: AT },
        [ReportSection.Risks]: { text: "Export controls.", revisedAt: AT + 5 },
      },
    },
  });
});

test("a null valuation drops the range, and an inverted one is refused", () => {
  expect(
    reviseReport(first(), { symbol: TSMC, valuation: null }, AT)
  ).toMatchObject({ report: { valuation: null } });

  expect(
    reviseReport(
      first(),
      { symbol: TSMC, valuation: { low: 1200, high: 1000, basis: "DCF" } },
      AT
    )
  ).toEqual({
    ok: false,
    violations: [
      { code: ReportViolationCode.ValuationInverted, low: 1200, high: 1000 },
    ],
  });
});

test("a draft refuses text that looks like a key", () => {
  const draft = reportDraftSchema.safeParse({
    symbol: TSMC,
    thesis: "Use sk-abcdefghijklmnopqrstuvwxyz to read the filings.",
  });

  expect(draft.success).toBe(false);
});
