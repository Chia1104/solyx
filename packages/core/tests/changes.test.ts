import { expect, test } from "vite-plus/test";

import { EventTiming } from "../src/calendar.ts";
import { ChangeKind, changeText, changesSince } from "../src/changes.ts";
import { Market } from "../src/market.ts";
import { ReportStance } from "../src/report.ts";
import type { Report } from "../src/report.ts";
import type { FalsifierCheck } from "../src/research.ts";
import type { ThemeWatch } from "../src/theme.ts";

const TSMC = { market: Market.TW, symbol: "2330" };

const taipei = (time: string) => Date.parse(`${time}+08:00`);

const SINCE = taipei("2026-10-16T08:30:00");

const FALSIFIER = "Monthly revenue falls year on year two months running.";

const REPORT: Report = {
  symbol: TSMC,
  revision: 2,
  revisedAt: taipei("2026-10-01T10:00:00"),
  financialsThrough: null,
  stance: ReportStance.Bullish,
  thesis: "Advanced nodes stay sold out.",
  drivers: [],
  risks: [],
  falsifiers: [FALSIFIER],
  valuation: null,
  events: [
    {
      date: "2026-10-16",
      label: "Earnings call",
      timing: EventTiming.Set,
      source: "Investor relations",
      quote: "October 16, 2026",
      support: null,
    },
    {
      date: "2026-10-05",
      label: "Technology forum",
      timing: EventTiming.Set,
      source: "Investor relations",
      quote: "October 5, 2026",
      support: null,
    },
  ],
  sections: {},
};

const check = (patch: Partial<FalsifierCheck>): FalsifierCheck => ({
  falsifier: FALSIFIER,
  revision: 2,
  source: "web-article",
  item: {
    id: "a",
    title: "Revenue falls again",
    url: null,
    site: "news.test",
    published: null,
  },
  support: { model: "jev", supported: 0.9 },
  checkedAt: SINCE + 1,
  ...patch,
});

const SIGNPOST = "A port suspends operations.";

const theme = (checkedAt: number[]): ThemeWatch => ({
  theme: {
    id: "outbreak",
    title: "Outbreak",
    thesis: "It could close ports.",
    queries: ["outbreak"],
    signposts: [SIGNPOST],
    listings: [],
    createdAt: 0,
    updatedAt: 0,
  },
  developments: checkedAt.map((at, index) => ({
    signpost: SIGNPOST,
    item: {
      id: String(index),
      title: "Port closed",
      snippet: "",
      url: null,
      site: "news.test",
      published: null,
      foundAt: at,
    },
    support: { model: "jev", supported: 0.9 },
    checkedAt: at,
  })),
  latest: [],
  collectedAt: null,
  quietSince: 0,
});

test("a falsifier read as stated since then is told once, however many items state it", () => {
  const changes = (checks: FalsifierCheck[]) =>
    changesSince(SINCE, SINCE + 60_000, {
      reports: [{ report: { ...REPORT, events: [] }, checks }],
      themes: [],
    });

  expect(changes([check({}), check({ checkedAt: SINCE + 2 })])).toEqual([
    { kind: ChangeKind.FalsifierMet, symbol: TSMC, falsifier: FALSIFIER },
  ]);
  expect(
    changes([
      check({ checkedAt: SINCE }),
      check({ support: { model: "jev", supported: 0.2 } }),
      check({ revision: 1 }),
      check({ falsifier: "One the report no longer holds." }),
    ])
  ).toEqual([]);
});

test("an event is told the day after its day, once", () => {
  const changes = (since: number, now: number) =>
    changesSince(since, now, {
      reports: [{ report: REPORT, checks: [] }],
      themes: [],
    });

  // Still its day on the exchange.
  expect(changes(SINCE, taipei("2026-10-16T23:00:00"))).toEqual([]);
  expect(changes(SINCE, taipei("2026-10-17T08:30:00"))).toEqual([
    {
      kind: ChangeKind.EventPassed,
      symbol: TSMC,
      date: "2026-10-16",
      label: "Earnings call",
    },
  ]);
  // Told to the run of the 17th, so not again.
  expect(
    changes(taipei("2026-10-17T08:30:00"), taipei("2026-10-18T08:30:00"))
  ).toEqual([]);
});

test("a signpost read as stated since then is told once, by its theme", () => {
  expect(
    changesSince(SINCE, SINCE + 60_000, {
      reports: [],
      themes: [theme([SINCE - 1, SINCE + 1, SINCE + 2])],
    })
  ).toEqual([
    { kind: ChangeKind.SignpostMet, theme: "Outbreak", signpost: SIGNPOST },
  ]);
  expect(
    changesSince(SINCE, SINCE + 60_000, {
      reports: [],
      themes: [theme([SINCE])],
    })
  ).toEqual([]);
});

test("each change reads as a line that names what it is about", () => {
  expect(
    changesSince(SINCE, taipei("2026-10-17T08:30:00"), {
      reports: [{ report: REPORT, checks: [check({})] }],
      themes: [theme([SINCE + 1])],
    }).map(changeText)
  ).toEqual([
    `TW 2330: news may state the falsifier "${FALSIFIER}"`,
    'TW 2330: the event "Earnings call" of 2026-10-16 has passed',
    `theme "Outbreak": news may state the signpost "${SIGNPOST}"`,
  ]);
});
