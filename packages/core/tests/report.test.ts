import { describe, expect, test } from "vite-plus/test";

import { EventTiming } from "../src/calendar.ts";
import type { Candle } from "../src/candles.ts";
import { Market } from "../src/market.ts";
import {
  ReportSection,
  ReportStance,
  ReportViolationCode,
  eventClaim,
  passedEvents,
  reportDraftSchema,
  reviseReport,
  stanceSpells,
} from "../src/report.ts";
import type { Report, ReportEvent } from "../src/report.ts";

const TSMC = { market: Market.TW, symbol: "2330" };

const AT = 1_790_000_000_000;

const NOW = {
  at: AT,
  today: "2026-09-21",
  financialsThrough: "2026-06-30",
  support: () => null,
};

const CALL: ReportEvent = {
  date: "2026-10-16",
  label: "Third-quarter earnings call",
  timing: EventTiming.Set,
  source: "Investor relations calendar",
  quote: "3Q26 Earnings Conference: October 16, 2026",
};

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

test("an event the draft names is kept with the reading its day was given", () => {
  const reading = { model: "jev", supported: 0.9 };
  const read: string[] = [];

  const revision = reviseReport(
    first(),
    { symbol: TSMC, events: [CALL] },
    {
      ...NOW,
      support(claim) {
        read.push(claim.text);

        return reading;
      },
    }
  );

  expect(revision).toMatchObject({
    report: { events: [{ ...CALL, support: reading }] },
  });
  expect(read).toContain(
    "Third-quarter earnings call, on 2026-10-16 (民國 115 年 10 月 16 日)"
  );
});

test("an event already behind today, or whose quote does not give its day, is refused", () => {
  const launch = { ...CALL, date: "2026-09-20", label: "Product launch" };

  expect(
    reviseReport(
      first(),
      { symbol: TSMC, events: [CALL, launch] },
      {
        ...NOW,
        support: ({ text }) =>
          text.startsWith("Third")
            ? { model: "jev", supported: 0.1 }
            : { model: "jev", supported: 0.9 },
      }
    )
  ).toEqual({
    ok: false,
    violations: [
      {
        code: ReportViolationCode.EventUnsupported,
        date: "2026-10-16",
        label: "Third-quarter earnings call",
        supported: 0.1,
      },
      {
        code: ReportViolationCode.EventPassed,
        date: "2026-09-20",
        label: "Product launch",
      },
    ],
  });
});

test("an event carried over stays once its day has passed, and is named as passed", () => {
  const written = reviseReport(first(), { symbol: TSMC, events: [CALL] }, NOW);

  if (!written.ok) throw new Error("The revision was refused");

  const later = reviseReport(
    written.report,
    { symbol: TSMC, thesis: "The call confirmed demand." },
    { ...NOW, today: "2026-10-20" }
  );

  if (!later.ok) throw new Error("The revision was refused");

  expect(later.report.events).toEqual([{ ...CALL, support: null }]);
  expect(passedEvents(later.report, "2026-10-16")).toEqual([]);
  expect(passedEvents(later.report, "2026-10-17")).toEqual([
    { ...CALL, support: null },
  ]);
});

test("a day fixed in Taiwan is named in the ROC calendar too, and one only expected without its year", () => {
  const text = (timing: EventTiming, market: Market) =>
    eventClaim({ ...CALL, label: "Call", timing }, market).text;

  expect(text(EventTiming.Deadline, Market.TW)).toBe(
    "Call, by 2026-10-16 (民國 115 年 10 月 16 日)"
  );
  expect(text(EventTiming.Expected, Market.TW)).toBe(
    "Call, expected around 10/16"
  );
  expect(text(EventTiming.Set, Market.US)).toBe("Call, on 2026-10-16");
});

describe("stanceSpells", () => {
  const kept = (
    revision: number,
    day: string,
    stance: ReportStance
  ): Report => ({
    symbol: TSMC,
    revision,
    // Kept at 14:00 in Taipei that day.
    revisedAt: Date.parse(`${day}T14:00:00+08:00`),
    financialsThrough: null,
    stance,
    thesis: "Thesis.",
    drivers: [],
    risks: [],
    falsifiers: [],
    valuation: null,
    events: [],
    sections: {},
  });

  const close = (day: string, price: number): Candle => ({
    time: Date.parse(`${day}T00:00:00+08:00`) / 1000,
    open: price,
    high: price,
    low: price,
    close: price,
    volume: 1,
  });

  const DAILY = [
    close("2026-09-01", 100),
    close("2026-09-02", 104),
    close("2026-09-03", 110),
    close("2026-09-04", 99),
    close("2026-09-07", 90),
  ];

  const INDEX = [
    close("2026-09-01", 1000),
    close("2026-09-02", 1010),
    close("2026-09-03", 1020),
    close("2026-09-04", 1020),
    close("2026-09-07", 1010),
  ];

  test("a stretch runs from the day a stance was taken to the day a revision changed it, and the last one stands", () => {
    const spells = stanceSpells(
      [
        kept(1, "2026-09-01", ReportStance.Bullish),
        // The same stance again is the same stretch.
        kept(2, "2026-09-02", ReportStance.Bullish),
        kept(3, "2026-09-03", ReportStance.Bearish),
      ],
      DAILY,
      INDEX
    );

    expect(
      spells.map(({ stance, revision, from, until, sessions }) => [
        stance,
        revision,
        from,
        until,
        sessions,
      ])
    ).toEqual([
      [ReportStance.Bullish, 1, "2026-09-01", "2026-09-03", 2],
      [ReportStance.Bearish, 3, "2026-09-03", null, 2],
    ]);
    expect(spells[0].change).toBeCloseTo(0.1);
    expect(spells[0].benchmark).toBeCloseTo(0.02);
    expect(spells[1].change).toBeCloseTo(90 / 110 - 1);
    expect(spells[1].benchmark).toBeCloseTo(1010 / 1020 - 1);
  });

  test("a stance taken on a day without a session stands on the close before it", () => {
    // Saturday 2026-09-05: the close of Friday the 4th.
    const [spell] = stanceSpells(
      [kept(1, "2026-09-05", ReportStance.Bullish)],
      DAILY,
      INDEX
    );

    expect(spell).toMatchObject({ from: "2026-09-05", sessions: 1 });
    expect(spell.change).toBeCloseTo(90 / 99 - 1);
  });

  test("a stretch with nothing to measure it by is left out", () => {
    // Taken before the bars begin, and taken on the newest bar's day.
    expect(
      stanceSpells(
        [
          kept(1, "2026-08-20", ReportStance.Bullish),
          kept(2, "2026-09-07", ReportStance.Neutral),
        ],
        DAILY,
        INDEX
      )
    ).toEqual([]);
    expect(
      stanceSpells([kept(1, "2026-09-01", ReportStance.Bullish)], DAILY, [])
    ).toEqual([]);
  });
});
