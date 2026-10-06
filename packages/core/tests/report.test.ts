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

const NOW = { at: AT, financialsThrough: "2026-06-30", support: () => null };

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
    NOW
  );

  if (!revision.ok) throw new Error("The first revision was refused");

  return revision.report;
}

test("a listing's first revision needs a stance and a thesis", () => {
  expect(reviseReport(null, { symbol: TSMC }, NOW)).toEqual({
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
    { ...NOW, at: AT + 5, financialsThrough: "2026-09-30" }
  );

  expect(revision).toMatchObject({
    ok: true,
    report: {
      revision: 2,
      revisedAt: AT + 5,
      financialsThrough: "2026-09-30",
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
    reviseReport(first(), { symbol: TSMC, valuation: null }, NOW)
  ).toMatchObject({ report: { valuation: null } });

  expect(
    reviseReport(
      first(),
      { symbol: TSMC, valuation: { low: 1200, high: 1000, basis: "DCF" } },
      NOW
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

test("a revision's own claims take their readings, and the claims it leaves keep theirs", () => {
  const driver = {
    point: "Demand is still strong.",
    text: "August revenue rose 53% on the year.",
    source: "Monthly revenue, 2026-08",
    quote: "YoY 53.3%",
  };

  const risk = {
    point: "Margins may narrow.",
    text: "Overseas fabs cost more to run.",
    source: "Annual report",
    quote: "higher costs at overseas fabs",
  };

  const reading = { model: "jev", supported: 0.9 };

  const written = reviseReport(
    first(),
    { symbol: TSMC, drivers: [driver] },
    { ...NOW, support: () => reading }
  );

  if (!written.ok) throw new Error("The revision was refused");

  const next = reviseReport(
    written.report,
    { symbol: TSMC, risks: [risk] },
    NOW
  );

  expect(next).toMatchObject({
    report: {
      drivers: [{ ...driver, support: reading }],
      risks: [{ ...risk, support: null }],
    },
  });
});

test("a claim whose quote says less than it asserts is refused", () => {
  const driver = {
    point: "Growth has further to run.",
    text: "Orders will double next year.",
    source: "Earnings call",
    quote: "We expect demand to stay robust.",
  };

  expect(
    reviseReport(
      first(),
      { symbol: TSMC, drivers: [driver] },
      { ...NOW, support: () => ({ model: "jev", supported: 0.05 }) }
    )
  ).toEqual({
    ok: false,
    violations: [
      {
        code: ReportViolationCode.ClaimUnsupported,
        claim: "Orders will double next year.",
        supported: 0.05,
      },
    ],
  });
});
