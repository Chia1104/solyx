import { uniqBy } from "es-toolkit";
import { expect, test, vi } from "vite-plus/test";
import type { Mock } from "vite-plus/test";

import { createSearchIndex } from "@solyx/utils/search";

import { EventTiming } from "../src/calendar.ts";
import { Interval } from "../src/candles.ts";
import type { Candle } from "../src/candles.ts";
import {
  CouncilOutcome,
  MagiUnit,
  MagiVote,
  councilOutcome,
  resolveCouncil,
  resolveCouncils,
} from "../src/council.ts";
import { ForecastDirection, ForecastViolationCode } from "../src/forecast.ts";
import type { FactReader, Forecast, ForecastDraft } from "../src/forecast.ts";
import type { Fundamentals } from "../src/fundamentals.ts";
import { Market, symbolKey } from "../src/market.ts";
import type { SymbolRef } from "../src/market.ts";
import { NewsChannel, TimePrecision } from "../src/news.ts";
import type { NewsRecord } from "../src/news.ts";
import { ReportStance, ReportViolationCode } from "../src/report.ts";
import type { ClaimAuditor, Report } from "../src/report.ts";
import { FALSIFIER_FLOORS, ResearchDesk, WatchGap } from "../src/research.ts";
import type {
  FalsifierCheck,
  FalsifierPass,
  ResearchStore,
} from "../src/research.ts";
import { Stance } from "../src/sentiment.ts";

const TSMC = { market: Market.TW, symbol: "2330" };

const AT_ANCHOR = Date.parse("2026-09-29T14:00:00+08:00");

const AFTER_HORIZON = Date.parse("2026-10-01T14:00:00+08:00");

function bar(date: string, close: number): Candle {
  return {
    time: Date.parse(`${date}T00:00:00+08:00`) / 1000,
    open: close,
    high: close + 5,
    low: close - 5,
    close,
    volume: 1000,
  };
}

const ANCHOR_BAR = bar("2026-09-29", 1000);

const LATER_BARS = [bar("2026-09-30", 1010), bar("2026-10-01", 1020)];

/**
 * Sixty-four daily bars that end on the anchor: the close swings between 1100 and 1000 every two
 * sessions, so of its 62 moves over two sessions 32 fall and 30 rise.
 */
const HISTORY = Array.from({ length: 64 }, (_, index) =>
  bar(
    Temporal.PlainDate.from("2026-09-29")
      .subtract({ days: 63 - index })
      .toString(),
    index % 4 < 2 ? 1100 : 1000
  )
);

const draft: ForecastDraft = {
  instrument: TSMC,
  horizon: 2,
  direction: ForecastDirection.Long,
  plan: { entry: 1000, stop: 980, target: 1040 },
  scenarios: [
    {
      label: "Down",
      probability: 40,
      low: null,
      high: 1000,
      path: [{ session: 2, price: 980 }],
    },
    {
      label: "Up",
      probability: 60,
      low: 1000,
      high: null,
      path: [{ session: 2, price: 1030 }],
    },
  ],
  rationale: "Holds the 20-day average.",
  claims: [],
  contrary: null,
};

// Copies on the way in and out, like a database would, so the desk cannot lean on shared objects.
function memoryStore(): ResearchStore {
  const reports: Report[] = [];
  const forecasts = new Map<string, Forecast>();
  const checks: { symbol: string; check: FalsifierCheck }[] = [];
  const passes = new Map<string, FalsifierPass>();
  const passages = new Map<string, Float32Array>();

  return {
    report: (symbol) =>
      structuredClone(
        reports.findLast(
          (report) => symbolKey(report.symbol) === symbolKey(symbol)
        )
      ),
    addReport: (report) => void reports.push(structuredClone(report)),
    forecast: (id) => structuredClone(forecasts.get(id)),
    forecasts: (symbol) =>
      [...forecasts.values()]
        .filter(
          (forecast) =>
            !symbol || symbolKey(forecast.instrument) === symbolKey(symbol)
        )
        .map((forecast) => structuredClone(forecast)),
    addForecast: (forecast) =>
      void forecasts.set(forecast.id, structuredClone(forecast)),
    settle(id, outcome) {
      const forecast = forecasts.get(id);

      if (forecast) forecasts.set(id, { ...forecast, outcome });
    },
    searchReports: (query, limit, symbol) =>
      uniqBy(
        createSearchIndex(reports.toReversed(), (report) => [
          report.symbol.symbol,
          report.thesis,
        ])(query),
        (report) => symbolKey(report.symbol)
      )
        .filter(
          (report) => !symbol || symbolKey(report.symbol) === symbolKey(symbol)
        )
        .slice(0, limit)
        .map((report) => structuredClone(report)),
    searchForecasts: (query, limit, symbol) =>
      createSearchIndex([...forecasts.values()], (forecast) => [
        forecast.instrument.symbol,
        forecast.rationale,
      ])(query)
        .filter(
          (forecast) =>
            !symbol || symbolKey(forecast.instrument) === symbolKey(symbol)
        )
        .slice(0, limit)
        .map((forecast) => structuredClone(forecast)),
    falsifierChecks: (symbol, revision) =>
      checks
        .filter(
          (each) =>
            each.symbol === symbolKey(symbol) &&
            each.check.revision === revision
        )
        .map(({ check }) => structuredClone(check)),
    addFalsifierCheck: (symbol, check) =>
      void checks.push({
        symbol: symbolKey(symbol),
        check: structuredClone(check),
      }),
    falsifierPass: (symbol) => structuredClone(passes.get(symbolKey(symbol))),
    setFalsifierPass: (symbol, pass) =>
      void passes.set(symbolKey(symbol), structuredClone(pass)),
    reports: (symbol) =>
      reports
        .filter(
          (report) => !symbol || symbolKey(report.symbol) === symbolKey(symbol)
        )
        .map((report) => structuredClone(report)),
    passageVectors: (space, texts) =>
      new Map(
        texts.flatMap((text) => {
          const values = passages.get(`${space}\n${text}`);

          return values ? [[text, values] as const] : [];
        })
      ),
    savePassageVectors(space, vectors) {
      for (const key of passages.keys()) {
        if (!key.startsWith(`${space}\n`)) passages.delete(key);
      }

      for (const { text, values } of vectors) {
        passages.set(`${space}\n${text}`, values);
      }
    },
  };
}

function setup() {
  const clock = { now: AT_ANCHOR };
  const bars = { daily: [ANCHOR_BAR] };
  const onChange = vi.fn();

  const candles = vi.fn<(symbol: SymbolRef) => Promise<Candle[]>>(async () =>
    structuredClone(bars.daily)
  );

  const quarters = { newest: "2026-06-30" };

  const statements = vi.fn(async () => [
    {
      periodEnd: quarters.newest,
      knownFrom: quarters.newest,
      revenue: 1,
      grossProfit: null,
      operatingIncome: null,
      netIncome: null,
      eps: null,
    },
  ]);

  const dividends = vi.fn<Fundamentals["dividends"]>(async () => []);
  const store = memoryStore();

  const desk = new ResearchDesk({
    store,
    marketData: { candles },
    fundamentals: { statements, dividends },
    onChange,
    now: () => clock.now,
    createId: () => "f-1",
  });

  const cover = () =>
    desk.revise({
      symbol: TSMC,
      stance: ReportStance.Bullish,
      thesis: "Advanced nodes stay sold out.",
    });

  return {
    desk,
    store,
    clock,
    bars,
    candles,
    quarters,
    statements,
    dividends,
    onChange,
    cover,
  };
}

test("a revision is kept, numbered after the last and stamped with the newest quarter", async () => {
  const { desk, store, cover, onChange } = setup();

  await cover();

  expect(store.report(TSMC)?.financialsThrough).toBe("2026-06-30");
  expect(
    await desk.revise({ symbol: TSMC, stance: ReportStance.Neutral })
  ).toMatchObject({
    ok: true,
    report: { revision: 2, stance: ReportStance.Neutral },
  });
  expect(store.report(TSMC)?.revision).toBe(2);
  expect(onChange).toHaveBeenCalledTimes(2);
});

test("a refused revision keeps nothing", async () => {
  const { desk, store, onChange } = setup();

  expect((await desk.revise({ symbol: TSMC })).ok).toBe(false);
  expect(store.report(TSMC)).toBeUndefined();
  expect(onChange).not.toHaveBeenCalled();
});

test("a forecast is stamped with the newest daily bar and the report it was made under", async () => {
  const { desk, cover, candles } = setup();

  await cover();

  expect(await desk.forecast(draft)).toEqual({
    ok: true,
    forecast: {
      ...draft,
      // One bar holds no move to measure a band against.
      baseRates: null,
      id: "f-1",
      createdAt: AT_ANCHOR,
      anchor: { date: "2026-09-29", price: 1000 },
      reportRevision: 1,
      motions: null,
      evidence: null,
      outcome: null,
    },
  });
  expect(candles).toHaveBeenCalledWith(TSMC, Interval.OneDay);
});

test("a forecast keeps the base rates of its bands, from the listing's own moves over its horizon", async () => {
  const { desk, cover, bars } = setup();

  await cover();
  bars.daily = HISTORY;

  const result = await desk.forecast(draft);

  // Below 1000 and from 1000 up, carried from the anchor's 1000.
  expect(result.ok && result.forecast.baseRates).toEqual([32 / 62, 30 / 62]);
});

test("a direction the probabilities lean away from history's is refused, and one without a plan is kept", async () => {
  const { desk, cover, bars } = setup();

  await cover();
  bars.daily = HISTORY;

  // History puts 52% below 1000 and 48% from it up; the draft gives them 40% and 60%.
  expect(
    await desk.forecast({
      ...draft,
      direction: ForecastDirection.Short,
      plan: null,
      contrary: "Stretched above its average.",
    })
  ).toEqual({
    ok: false,
    violations: [
      {
        code: ForecastViolationCode.LeanOpposed,
        lean: expect.closeTo(0.23, 2),
      },
    ],
  });

  expect(await desk.forecast({ ...draft, plan: null })).toMatchObject({
    ok: true,
    forecast: { direction: ForecastDirection.Long, plan: null },
  });
});

test("the horizon's history is the listing's moves of that length and where they land between the edges", async () => {
  const { desk, bars } = setup();

  bars.daily = HISTORY;

  const history = await desk.horizonHistory(TSMC, 2, [1000]);

  expect(history.anchor).toEqual({ date: "2026-09-29", price: 1000 });
  expect(history.since).toBe("2026-07-28");
  expect(history.moves).toHaveLength(62);
  expect(history.rates).toEqual([32 / 62, 30 / 62]);

  bars.daily = [];

  await expect(desk.horizonHistory(TSMC, 2, [1000])).rejects.toThrow(
    "TW:2330 has no daily bars"
  );
});

test("a refused forecast keeps nothing", async () => {
  const { desk, store } = setup();

  expect(await desk.forecast(draft)).toEqual({
    ok: false,
    violations: [{ code: ForecastViolationCode.NoReport }],
  });
  expect(store.forecasts()).toEqual([]);
});

test("a session takes one forecast, and the next takes another", async () => {
  const { desk, cover, bars } = setup();

  await cover();
  await desk.forecast(draft);

  expect(await desk.forecast(draft)).toEqual({
    ok: false,
    violations: [
      { code: ForecastViolationCode.AlreadyForecast, date: "2026-09-29" },
    ],
  });

  bars.daily = [ANCHOR_BAR, LATER_BARS[0]];

  expect((await desk.forecast(draft)).ok).toBe(true);
});

test("forecasting under an id again returns the forecast already made", async () => {
  const { desk, store, cover, candles } = setup();

  await cover();

  const first = await desk.forecast({ ...draft, id: "run-1" });

  candles.mockClear();

  expect(await desk.forecast({ ...draft, id: "run-1" })).toEqual(first);
  expect(store.forecasts()).toHaveLength(1);
  expect(candles).not.toHaveBeenCalled();
});

test("a forecast waits for the listing's distributions before it settles, and is judged with what went ex added back", async () => {
  const { desk, store, cover, clock, bars, dividends } = setup();

  await cover();
  await desk.forecast(draft);

  clock.now = AFTER_HORIZON;
  // 40 went ex on the horizon's session, where the bars close at 980.
  bars.daily = [ANCHOR_BAR, bar("2026-09-30", 1010), bar("2026-10-01", 980)];
  dividends.mockRejectedValueOnce(new Error("FinMind answered 402"));

  // An outcome is kept once, so one judged without the distribution could not be put right.
  expect((await desk.coverage(TSMC)).forecasts[0].outcome).toBe(null);

  dividends.mockResolvedValue([
    {
      period: "115年第2季",
      announced: null,
      cash: 40,
      stock: 0,
      cashExDate: "2026-10-01",
      cashPaidOn: null,
      stockExDate: null,
    },
  ]);

  await desk.coverage(TSMC);

  // 980 as traded, and 1020 with the 40 added back: the "Up" band.
  expect(store.forecast("f-1")?.outcome).toMatchObject({
    close: 980,
    distributed: 40,
    scenario: 1,
  });
});

test("a listing without bars cannot anchor a forecast", async () => {
  const { desk, cover, bars } = setup();

  await cover();
  bars.daily = [];

  await expect(desk.forecast(draft)).rejects.toThrow(
    "TW:2330 has no daily bars"
  );
});

test("coverage settles a forecast once its horizon has closed, and keeps the outcome", async () => {
  const { desk, store, cover, clock, bars, candles, onChange } = setup();

  await cover();
  await desk.forecast(draft);

  expect((await desk.coverage(TSMC)).forecasts[0].outcome).toBe(null);

  clock.now = AFTER_HORIZON;
  bars.daily = [ANCHOR_BAR, ...LATER_BARS];
  onChange.mockClear();

  const coverage = await desk.coverage(TSMC);

  expect(coverage.report?.revision).toBe(1);
  expect(coverage.forecasts[0].outcome).toMatchObject({
    date: "2026-10-01",
    close: 1020,
    scenario: 1,
  });
  expect(coverage.record).toMatchObject({ forecasts: 1, settled: 1 });
  expect(store.forecast("f-1")?.outcome?.close).toBe(1020);
  expect(onChange).toHaveBeenCalledExactlyOnceWith(TSMC);

  // Nothing is left to judge: the outcome stays as it was kept, and nothing is told again.
  bars.daily = [ANCHOR_BAR, LATER_BARS[0], bar("2026-10-01", 900)];
  onChange.mockClear();

  expect((await desk.coverage(TSMC)).forecasts[0].outcome?.close).toBe(1020);
  expect(onChange).not.toHaveBeenCalled();
  expect(candles).toHaveBeenCalledWith(TSMC, Interval.OneDay);
});

test("coverage measures each stretch of one stance against the market's index", async () => {
  const { desk, cover, clock, candles } = setup();

  // The listing rose 5% over the two sessions after the report was kept, and the index 1%.
  candles.mockImplementation(async (symbol) =>
    symbol.symbol === TSMC.symbol
      ? [ANCHOR_BAR, bar("2026-09-30", 1010), bar("2026-10-01", 1050)]
      : [
          bar("2026-09-29", 20000),
          bar("2026-09-30", 20100),
          bar("2026-10-01", 20200),
        ]
  );

  await cover();
  clock.now = AFTER_HORIZON;

  const { stances } = await desk.coverage(TSMC);

  expect(stances).toEqual([
    {
      stance: ReportStance.Bullish,
      revision: 1,
      from: "2026-09-29",
      until: null,
      sessions: 2,
      change: 1050 / 1000 - 1,
      benchmark: 20200 / 20000 - 1,
    },
  ]);
  expect(candles).toHaveBeenCalledWith(
    { market: Market.TW, symbol: "IX0001" },
    Interval.OneDay
  );

  candles.mockRejectedValue(new Error("Fugle answered 503"));

  // The report still reads while the bars are out of reach.
  expect((await desk.coverage(TSMC)).stances).toEqual([]);
});

test("coverage still reads what is kept while bars are out of reach", async () => {
  const { desk, cover, candles } = setup();

  await cover();
  await desk.forecast(draft);
  candles.mockRejectedValue(new Error("No source covers TW"));

  expect(await desk.coverage(TSMC)).toMatchObject({
    report: { revision: 1 },
    forecasts: [{ id: "f-1", outcome: null }],
  });
});

test("the track record settles every listing's forecasts", async () => {
  const { desk, cover, clock, bars } = setup();

  await cover();
  await desk.forecast(draft);

  clock.now = AFTER_HORIZON;
  bars.daily = [ANCHOR_BAR, ...LATER_BARS];

  expect(await desk.trackRecord()).toMatchObject({
    forecasts: 1,
    settled: 1,
    motions: null,
  });
});

test("a search names each listing's newest revision and settles the forecasts it finds", async () => {
  const { desk, store, cover, clock, bars } = setup();

  await cover();
  await desk.forecast(draft);
  await desk.revise({ symbol: TSMC, thesis: "Margins hold." });

  clock.now = AFTER_HORIZON;
  bars.daily = [ANCHOR_BAR, ...LATER_BARS];

  const found = await desk.search("advanced average", 5);

  expect(found.reports).toEqual([
    { report: expect.objectContaining({ revision: 1 }), newest: 2 },
  ]);
  expect(found.forecasts).toMatchObject([
    { id: "f-1", outcome: { close: 1020 } },
  ]);
  expect(store.forecast("f-1")?.outcome?.close).toBe(1020);
  expect(await desk.search("advanced", 5, { ...TSMC, symbol: "2454" })).toEqual(
    { reports: [], forecasts: [] }
  );
});

test("a newer quarter makes the report stale until it is revised", async () => {
  const { desk, cover, quarters } = setup();

  await cover();
  quarters.newest = "2026-09-30";

  expect(await desk.coverage(TSMC)).toMatchObject({
    newerFinancials: "2026-09-30",
  });
  expect(await desk.forecast(draft)).toEqual({
    ok: false,
    violations: [
      { code: ForecastViolationCode.ReportStale, periodEnd: "2026-09-30" },
    ],
  });

  await desk.revise({ symbol: TSMC, thesis: "Third-quarter margins held." });

  expect((await desk.coverage(TSMC)).newerFinancials).toBe(null);
  expect((await desk.forecast(draft)).ok).toBe(true);
});

test("research goes on while fundamentals are out of reach", async () => {
  const { desk, store, cover, statements } = setup();

  statements.mockRejectedValue(new Error("FinMind answered 402"));
  await cover();

  expect(store.report(TSMC)?.financialsThrough).toBe(null);
  expect((await desk.forecast(draft)).ok).toBe(true);
});

test("claims are read against their quotes as they are kept, and stay when the model fails", async () => {
  const { store } = setup();
  const bars = [ANCHOR_BAR];

  const claim = (text: string) => ({ text, source: "Filing", quote: text });

  const audit = vi
    .fn()
    .mockResolvedValueOnce({ model: "jev", supported: 0.9 })
    .mockRejectedValueOnce(new Error("The model is out of reach"))
    .mockResolvedValueOnce({ model: "jev", supported: 0.2 })
    .mockResolvedValueOnce({ model: "jev", supported: 0.8 });

  const desk = new ResearchDesk({
    store,
    marketData: { candles: async () => bars },
    fundamentals: { statements: async () => [], dividends: async () => [] },
    auditor: async () => ({ audit }),
    now: () => AT_ANCHOR,
  });

  await desk.revise({
    symbol: TSMC,
    stance: ReportStance.Bullish,
    thesis: "Advanced nodes stay sold out.",
    drivers: [{ ...claim("Revenue rose."), point: "Demand is strong." }],
    risks: [{ ...claim("Costs rose."), point: "Margins may narrow." }],
  });

  expect(store.report(TSMC)).toMatchObject({
    drivers: [{ support: { model: "jev", supported: 0.9 } }],
    risks: [{ support: null }],
  });

  const claims = [claim("The average held.")];

  expect(await desk.forecast({ ...draft, claims })).toEqual({
    ok: false,
    violations: [
      {
        code: ForecastViolationCode.ClaimUnsupported,
        claim: "The average held.",
        supported: 0.2,
      },
    ],
  });
  expect(await desk.forecast({ ...draft, claims })).toMatchObject({
    ok: true,
    forecast: { claims: [{ support: { model: "jev", supported: 0.8 } }] },
  });
});

test("a report's events are read against their quotes, refused once behind the exchange's day, and named once they pass", async () => {
  const { store, clock } = setup();
  const audit = vi.fn(async () => ({ model: "jev", supported: 0.9 }));

  const desk = new ResearchDesk({
    store,
    marketData: { candles: async () => [ANCHOR_BAR] },
    fundamentals: { statements: async () => [], dividends: async () => [] },
    auditor: async () => ({ audit }),
    now: () => clock.now,
  });

  const call = {
    date: "2026-10-16",
    label: "Third-quarter earnings call",
    timing: EventTiming.Set,
    source: "Investor relations calendar",
    quote: "3Q26 Earnings Conference: October 16, 2026",
  };

  const report = {
    symbol: TSMC,
    stance: ReportStance.Bullish,
    thesis: "Advanced nodes stay sold out.",
  };

  expect(
    await desk.revise({
      ...report,
      events: [{ ...call, date: "2026-09-28", label: "Technology forum" }],
    })
  ).toEqual({
    ok: false,
    violations: [
      {
        code: ReportViolationCode.EventPassed,
        date: "2026-09-28",
        label: "Technology forum",
      },
    ],
  });

  await desk.revise({ ...report, events: [call] });

  expect(audit).toHaveBeenLastCalledWith({
    text: "Third-quarter earnings call, on 2026-10-16 (民國 115 年 10 月 16 日)",
    source: call.source,
    quote: call.quote,
  });

  const kept = { ...call, support: { model: "jev", supported: 0.9 } };

  expect(await desk.coverage(TSMC)).toMatchObject({
    report: { events: [kept] },
    passedEvents: [],
  });

  clock.now = Date.parse("2026-10-17T09:00:00+08:00");

  expect((await desk.coverage(TSMC)).passedEvents).toEqual([kept]);
});

const votes = (...cast: (MagiVote | null)[]) =>
  resolveCouncil(
    Object.values(MagiUnit).map((unit, index) => ({
      unit,
      vote: cast[index],
      reason: "",
      model: "faux",
    }))
  );

test("two votes carry a motion, and a unit that gave none counts for neither side", () => {
  const { Approve, Reject } = MagiVote;

  expect(votes(Approve, Approve, Reject).carried).toBe(true);
  expect(votes(Approve, Reject, Reject).carried).toBe(false);
  expect(votes(Approve, null, Approve).carried).toBe(true);
  expect(votes(Approve, null, null).carried).toBe(false);
});

test("a motion the missing votes could have carried is undecided rather than rejected", () => {
  const { Approve, Reject } = MagiVote;

  expect(councilOutcome(votes(Approve, Approve, null))).toBe(
    CouncilOutcome.Carried
  );
  expect(councilOutcome(votes(Approve, null, Reject))).toBe(
    CouncilOutcome.Undecided
  );
  expect(councilOutcome(votes(Reject, null, null))).toBe(
    CouncilOutcome.Undecided
  );
  expect(councilOutcome(votes(Reject, Reject, null))).toBe(
    CouncilOutcome.Rejected
  );
  expect(councilOutcome(votes(Approve, Reject, Reject))).toBe(
    CouncilOutcome.Rejected
  );
});

test("several motions put at once are each counted from every unit's vote on it", () => {
  const { Approve, Reject } = MagiVote;

  const [first, second] = [
    votes(Approve, Approve, Reject),
    votes(Reject, null, Reject),
  ];

  // Each unit's votes, in the motions' order.
  const ballots = Object.values(MagiUnit).map((_, unit) => [
    first.votes[unit],
    second.votes[unit],
  ]);

  expect(resolveCouncils(ballots)).toEqual([first, second]);
});

test("a forecast's scenarios are put to a vote against their base rates, and it is kept however they went", async () => {
  const { desk, cover, bars } = setup();

  const motions = [
    votes(MagiVote.Reject, MagiVote.Reject, MagiVote.Approve),
    votes(MagiVote.Reject, MagiVote.Approve, MagiVote.Reject),
  ];

  const vote = vi.fn(async () => motions);

  await cover();
  bars.daily = HISTORY;

  expect(await desk.forecast(draft, vote)).toMatchObject({
    ok: true,
    forecast: { motions },
  });
  expect(vote).toHaveBeenCalledExactlyOnceWith({
    draft,
    anchor: { date: "2026-09-29", price: 1000 },
    report: expect.objectContaining({ revision: 1 }),
    baseRates: [32 / 62, 30 / 62],
    evidence: null,
  });
});

/** A fact's reading with all of its weight on one level. */
const readAs = (level: Stance) => ({
  model: "jev",
  stance: {
    [Stance.Negative]: 0,
    [Stance.LeanNegative]: 0,
    [Stance.Neutral]: 0,
    [Stance.LeanPositive]: 0,
    [Stance.Positive]: 0,
    [level]: 1,
  },
});

/** A desk over the listing's history whose facts `read` reads, with a report in force. */
async function reading(read: FactReader["read"]) {
  const store = memoryStore();

  const desk = new ResearchDesk({
    store,
    marketData: { candles: async () => HISTORY },
    fundamentals: { statements: async () => [], dividends: async () => [] },
    reader: async () => ({ read }),
    now: () => AT_ANCHOR,
  });

  await desk.revise({
    symbol: TSMC,
    stance: ReportStance.Bullish,
    thesis: "Advanced nodes stay sold out.",
  });

  return { desk, store };
}

const fact = (text: string) => ({ text, source: "Filing", quote: text });

test("the facts a forecast rests on are each read alone once it passes, and it is kept and voted on with their mean", async () => {
  const read = vi.fn<FactReader["read"]>(async ({ text }) =>
    readAs(text === "Revenue rose." ? Stance.Positive : Stance.Neutral)
  );

  const { desk } = await reading(read);
  const vote = vi.fn(async () => [votes(), votes()]);

  const evidence = {
    model: "jev",
    facts: 2,
    stance: { ...readAs(Stance.Neutral).stance, neutral: 0.5, positive: 0.5 },
  };

  expect(
    await desk.forecast(
      { ...draft, claims: [fact("Revenue rose."), fact("The low was 990.")] },
      vote
    )
  ).toMatchObject({ ok: true, forecast: { evidence } });
  expect(read).toHaveBeenCalledTimes(2);
  expect(vote).toHaveBeenCalledWith(expect.objectContaining({ evidence }));
});

test("a fact the model cannot be reached for is left out, and a forecast none was read for is kept unread", async () => {
  const claims = [fact("Revenue rose."), fact("Costs rose.")];
  const unreachable = new Error("The model is out of reach");

  const one = await reading(
    vi
      .fn<FactReader["read"]>()
      .mockRejectedValueOnce(unreachable)
      .mockResolvedValueOnce(readAs(Stance.Negative))
  );

  expect(await one.desk.forecast({ ...draft, claims })).toMatchObject({
    ok: true,
    forecast: { evidence: { facts: 1, stance: { negative: 1 } } },
  });

  const none = await reading(
    vi.fn<FactReader["read"]>().mockRejectedValue(unreachable)
  );

  expect(await none.desk.forecast({ ...draft, claims })).toMatchObject({
    ok: true,
    forecast: { evidence: null },
  });
});

test("a forecast is checked again once its facts are read, since the report or the session's forecast may have changed meanwhile", async () => {
  const claims = [fact("Revenue rose.")];
  const meanwhile = vi.fn<() => Promise<void>>();

  const read: FactReader["read"] = async () => {
    await meanwhile();

    return readAs(Stance.Positive);
  };

  // The report is revised while the model reads: the forecast is kept under the revision in force.
  const revised = await reading(read);

  meanwhile.mockImplementationOnce(async () => {
    await revised.desk.revise({ symbol: TSMC, thesis: "Margins hold." });
  });

  expect(await revised.desk.forecast({ ...draft, claims })).toMatchObject({
    ok: true,
    forecast: { reportRevision: 2 },
  });

  // Another conversation keeps the session's forecast while the model reads.
  const raced = await reading(read);

  const other = new ResearchDesk({
    store: raced.store,
    marketData: { candles: async () => HISTORY },
    fundamentals: { statements: async () => [], dividends: async () => [] },
    now: () => AT_ANCHOR,
  });

  meanwhile.mockImplementationOnce(async () => {
    await other.forecast(draft);
  });

  expect(await raced.desk.forecast({ ...draft, claims })).toEqual({
    ok: false,
    violations: [
      { code: ForecastViolationCode.AlreadyForecast, date: "2026-09-29" },
    ],
  });
  expect(raced.store.forecasts()).toHaveLength(1);
});

test("no fact is read for a forecast the checks refuse, or for one that cites none", async () => {
  const read = vi.fn<FactReader["read"]>(async () => readAs(Stance.Positive));
  const { desk } = await reading(read);

  expect(
    (
      await desk.forecast({
        ...draft,
        claims: [fact("Revenue rose.")],
        scenarios: draft.scenarios.map((scenario) => ({
          ...scenario,
          probability: 50,
        })),
        direction: ForecastDirection.Short,
      })
    ).ok
  ).toBe(false);
  expect(read).not.toHaveBeenCalled();

  expect(await desk.forecast(draft)).toMatchObject({
    ok: true,
    forecast: { evidence: null },
  });
  expect(read).not.toHaveBeenCalled();
});

test("a listing whose bars give its bands no base rates has no motion to put, and its forecast is kept without a vote", async () => {
  const { desk, cover } = setup();
  const vote = vi.fn();

  await cover();

  expect(await desk.forecast(draft, vote)).toMatchObject({
    ok: true,
    forecast: { baseRates: null, motions: null },
  });
  expect(vote).not.toHaveBeenCalled();
});

test("no vote is spent on a forecast the checks refuse", async () => {
  const { desk, bars } = setup();
  const vote = vi.fn();

  bars.daily = HISTORY;

  expect((await desk.forecast(draft, vote)).ok).toBe(false);
  expect(vote).not.toHaveBeenCalled();
});

const LOCAL_SPACE = [...FALSIFIER_FLOORS.keys()][0];

/** A news record whose vector lies `degrees` from [1, 0]. */
function nearby(id: string, degrees: number, space = LOCAL_SPACE): NewsRecord {
  const angle = (degrees * Math.PI) / 180;

  return {
    source: "news",
    channel: NewsChannel.Article,
    item: {
      id,
      url: `https://news.test/${id}`,
      title: id,
      snippet: "",
      site: "news.test",
      published: {
        at: new Date("2026-10-01T02:00:00Z"),
        precision: TimePrecision.Minute,
      },
      votes: null,
    },
    foundAt: new Date("2026-10-01T03:00:00Z"),
    score: null,
    embedding: {
      space,
      values: Float32Array.of(Math.cos(angle), Math.sin(angle)),
    },
  };
}

// Every falsifier's vector is [1, 0].
const localEmbedder = (space = LOCAL_SPACE) => ({
  space,
  embed: vi.fn(async (texts: readonly string[]) =>
    texts.map(() => Float32Array.of(1, 0))
  ),
});

function watching({
  audit = vi.fn<ClaimAuditor["audit"]>(),
  store = memoryStore(),
  embedder = localEmbedder(),
  audited = true,
}: {
  audit?: Mock<ClaimAuditor["audit"]>;
  store?: ResearchStore;
  /** `null` for none. */
  embedder?: ReturnType<typeof localEmbedder> | null;
  audited?: boolean;
} = {}) {
  const onChange = vi.fn();

  const desk = new ResearchDesk({
    store,
    marketData: { candles: async () => [ANCHOR_BAR] },
    fundamentals: { statements: async () => [], dividends: async () => [] },
    auditor: async () => (audited ? { audit } : undefined),
    embedder: () => embedder ?? undefined,
    onChange,
    now: () => AT_ANCHOR,
  });

  return { store, desk, onChange, audit, embedder };
}

const falsifiable = {
  symbol: TSMC,
  stance: ReportStance.Bullish,
  thesis: "Advanced nodes stay sold out.",
  falsifiers: ["Gross margin falls below 53%"],
};

test("each falsifier is read against the news nearest it once, and an item that states it is a signal", async () => {
  const audit = vi.fn<ClaimAuditor["audit"]>(async ({ quote }) => ({
    model: "jev",
    supported: quote === "margins fell" ? 0.9 : 0.1,
  }));

  const { desk, onChange } = watching({ audit });

  await desk.revise(falsifiable);
  onChange.mockClear();

  const records = [
    nearby("margins fell", 10),
    nearby("capex rose", 20),
    nearby("dividend set", 30),
    nearby("chip launch", 35),
    // cos 70° ≈ 0.34 lies below the floor.
    nearby("unrelated", 70),
  ];

  await desk.watch(TSMC, () => records);

  expect(audit.mock.calls.map(([claim]) => claim.quote)).toEqual([
    "margins fell",
    "capex rose",
    "dividend set",
  ]);
  expect(audit).toHaveBeenCalledWith({
    text: "Gross margin falls below 53%",
    source: "https://news.test/margins fell",
    quote: "margins fell",
  });
  expect(onChange).toHaveBeenCalledExactlyOnceWith(TSMC);

  const coverage = await desk.coverage(TSMC);

  expect(coverage.signals).toEqual([
    {
      falsifier: "Gross margin falls below 53%",
      revision: 1,
      source: "news",
      item: {
        id: "margins fell",
        title: "margins fell",
        url: "https://news.test/margins fell",
        site: "news.test",
        published: {
          at: new Date("2026-10-01T02:00:00Z"),
          precision: TimePrecision.Minute,
        },
      },
      support: { model: "jev", supported: 0.9 },
      checkedAt: AT_ANCHOR,
    },
  ]);
  expect(coverage.watch).toEqual({
    gaps: [],
    pass: { revision: 1, at: AT_ANCHOR, items: 5, unread: 0, failure: null },
  });

  audit.mockClear();
  await desk.watch(TSMC, () => records);

  expect(audit).not.toHaveBeenCalled();
});

test("nothing is read while a gap keeps it, and coverage names each gap", async () => {
  const store = memoryStore();
  const { desk, audit, embedder } = watching({ store });

  await desk.watch(TSMC, () => [nearby("margins fell", 0)]);
  expect((await desk.coverage(TSMC)).watch).toBeNull();

  await desk.revise({ ...falsifiable, falsifiers: [] });
  expect((await desk.coverage(TSMC)).watch).toBeNull();

  await desk.revise(falsifiable);
  expect((await desk.coverage(TSMC)).watch).toEqual({ gaps: [], pass: null });

  const unmeasured = watching({
    store,
    audit,
    embedder: localEmbedder("another-space"),
  });

  await unmeasured.desk.watch(TSMC, () => [
    nearby("margins fell", 0, "another-space"),
  ]);
  expect((await unmeasured.desk.coverage(TSMC)).watch).toEqual({
    gaps: [WatchGap.Unmeasured],
    pass: null,
  });

  const bare = watching({ store, audit, embedder: null, audited: false });

  await bare.desk.watch(TSMC, () => [nearby("margins fell", 0)]);
  expect((await bare.desk.coverage(TSMC)).watch).toEqual({
    gaps: [WatchGap.NoLocalEmbedder, WatchGap.NoAuditor],
    pass: null,
  });

  expect(audit).not.toHaveBeenCalled();
  expect(embedder?.embed).not.toHaveBeenCalled();
});

test("a pass is kept however it went: over no news, with items the model could not read, or failed", async () => {
  const audit = vi.fn<ClaimAuditor["audit"]>(async ({ quote }) => {
    if (quote === "capex rose") throw new Error("Jev: busy");

    return { model: "jev", supported: 0.1 };
  });

  const { desk, onChange, embedder } = watching({ audit });
  const passOf = async () => (await desk.coverage(TSMC)).watch?.pass;

  await desk.revise(falsifiable);

  await desk.watch(TSMC, () => [nearby("margins fell", 0, "another-space")]);
  expect(await passOf()).toMatchObject({ items: 0, unread: 0, failure: null });
  expect(embedder?.embed).not.toHaveBeenCalled();

  await desk.watch(TSMC, () => [
    nearby("margins fell", 10),
    nearby("capex rose", 20),
  ]);
  expect(await passOf()).toMatchObject({ items: 2, unread: 1, failure: null });

  // An item the model could not read is read again with the next pass.
  audit.mockClear();
  await desk.watch(TSMC, () => [
    nearby("margins fell", 10),
    nearby("capex rose", 20),
  ]);
  expect(audit.mock.calls.map(([claim]) => claim.quote)).toEqual([
    "capex rose",
  ]);

  await desk.revise({ ...falsifiable, falsifiers: ["Capex is cut"] });
  expect(await passOf()).toBeNull();

  embedder?.embed.mockRejectedValueOnce(new Error("Ollama: not running"));
  onChange.mockClear();

  await expect(
    desk.watch(TSMC, () => [nearby("margins fell", 10)])
  ).rejects.toThrow("Ollama: not running");
  expect(await passOf()).toEqual({
    revision: 2,
    at: AT_ANCHOR,
    items: 0,
    unread: 0,
    failure: "Ollama: not running",
  });
  expect(onChange).toHaveBeenCalledExactlyOnceWith(TSMC);
});

test("an item near several falsifiers that could not be read counts once", async () => {
  const audit = vi.fn<ClaimAuditor["audit"]>(async () => {
    throw new Error("Jev: busy");
  });

  const { desk } = watching({ audit });

  await desk.revise({
    ...falsifiable,
    falsifiers: ["Gross margin falls below 53%", "Capex is cut"],
  });
  await desk.watch(TSMC, () => [nearby("margins fell", 10)]);

  expect(audit).toHaveBeenCalledTimes(2);
  expect((await desk.coverage(TSMC)).watch?.pass).toMatchObject({
    items: 1,
    unread: 1,
  });
});

test("a listing's passes run one at a time, so the one kept last reads the revision in force", async () => {
  const answers: (() => void)[] = [];

  const audit = vi.fn<ClaimAuditor["audit"]>(
    () =>
      new Promise((resolve) =>
        answers.push(() => resolve({ model: "jev", supported: 0.1 }))
      )
  );

  const { desk } = watching({ audit });
  const records = () => [nearby("margins fell", 10)];

  await desk.revise(falsifiable);

  const first = desk.watch(TSMC, records);

  await vi.waitFor(() => expect(answers).toHaveLength(1));
  await desk.revise({ ...falsifiable, falsifiers: ["Capex is cut"] });

  const second = desk.watch(TSMC, records);

  // The second pass waits for the first rather than read beside it.
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(answers).toHaveLength(1);

  answers[0]();
  await vi.waitFor(() => expect(answers).toHaveLength(2));
  answers[1]();
  await Promise.all([first, second]);

  expect(audit.mock.calls.map(([claim]) => claim.text)).toEqual([
    "Gross margin falls below 53%",
    "Capex is cut",
  ]);
  expect((await desk.coverage(TSMC)).watch?.pass).toMatchObject({
    revision: 2,
  });
});

test("a search finds by meaning what shares no word with the query, beside what does, and goes on by words while vectors are out of reach", async () => {
  const { store, cover, desk: plain } = setup();

  // Vectors on two axes: near [1, 0] reads like the query, near [0, 1] does not.
  const axis = (text: string) =>
    /資本支出|capex|擴產/.test(text)
      ? Float32Array.of(1, 0)
      : Float32Array.of(0, 1);

  const embed = vi.fn(async (texts: readonly string[]) => texts.map(axis));
  const reachable = { up: true };

  const desk = new ResearchDesk({
    store,
    marketData: { candles: async () => [ANCHOR_BAR] },
    fundamentals: { statements: async () => [], dividends: async () => [] },
    embedder: () => ({
      space: "local",
      embed: async (texts: readonly string[]) => {
        if (!reachable.up) throw new Error("Ollama is not running");

        return embed(texts);
      },
    }),
    now: () => AT_ANCHOR,
  });

  await cover();
  await desk.revise({
    symbol: { ...TSMC, symbol: "2454" },
    stance: ReportStance.Neutral,
    thesis: "台積電擴產帶動設備需求。",
  });
  await desk.revise({
    symbol: { ...TSMC, symbol: "2317" },
    stance: ReportStance.Neutral,
    thesis: "Servers carry the year.",
  });

  const found = await desk.search("capex", 5);

  // The 2454 report says 擴產, which shares no word with "capex"; nothing else reads near it.
  expect(found.reports.map(({ report }) => report.symbol.symbol)).toEqual([
    "2454",
  ]);

  // What was embedded is kept, so a second search embeds the query alone.
  embed.mockClear();
  await desk.search("capex", 5);

  expect(embed.mock.calls).toEqual([[["capex"]]]);

  reachable.up = false;

  expect((await desk.search("advanced", 5)).reports).toMatchObject([
    { report: { symbol: { symbol: "2330" } } },
  ]);
  expect(await plain.search("capex", 5)).toEqual({
    reports: [],
    forecasts: [],
  });
});
