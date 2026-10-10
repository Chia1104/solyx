import { uniqBy } from "es-toolkit";
import { expect, test, vi } from "vite-plus/test";

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
} from "../src/council.ts";
import { ForecastDirection, ForecastViolationCode } from "../src/forecast.ts";
import type { Forecast, ForecastDraft } from "../src/forecast.ts";
import { InstrumentKind, Market, symbolKey } from "../src/market.ts";
import { NewsChannel, TimePrecision } from "../src/news.ts";
import type { NewsRecord } from "../src/news.ts";
import { ReportStance, ReportViolationCode } from "../src/report.ts";
import type { Report } from "../src/report.ts";
import { FALSIFIER_FLOORS, ResearchDesk } from "../src/research.ts";
import type { FalsifierCheck, ResearchStore } from "../src/research.ts";

const TSMC = { market: Market.TW, symbol: "2330", kind: InstrumentKind.Stock };

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
  const candles = vi.fn(async () => structuredClone(bars.daily));
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

  const store = memoryStore();

  const desk = new ResearchDesk({
    store,
    marketData: { candles },
    fundamentals: { statements },
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
      id: "f-1",
      createdAt: AT_ANCHOR,
      anchor: { date: "2026-09-29", price: 1000 },
      reportRevision: 1,
      council: null,
      outcome: null,
    },
  });
  expect(candles).toHaveBeenCalledWith(TSMC, Interval.OneDay);
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

  // Nothing is left to judge, so the bars are not read again.
  candles.mockClear();
  await desk.coverage(TSMC);

  expect(candles).not.toHaveBeenCalled();
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
    all: { forecasts: 1, settled: 1 },
    ratified: { forecasts: 0 },
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
    fundamentals: { statements: async () => [] },
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
    fundamentals: { statements: async () => [] },
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

test("a forecast put to a vote is kept with the vote that carried it", async () => {
  const { desk, cover } = setup();
  const council = votes(MagiVote.Approve, MagiVote.Approve, MagiVote.Reject);
  const ratify = vi.fn(async () => council);

  await cover();

  expect(await desk.forecast(draft, ratify)).toMatchObject({
    ok: true,
    forecast: { council },
  });
  expect(ratify).toHaveBeenCalledExactlyOnceWith({
    draft,
    anchor: { date: "2026-09-29", price: 1000 },
    report: expect.objectContaining({ revision: 1 }),
  });
  expect(await desk.trackRecord()).toMatchObject({
    all: { forecasts: 1 },
    ratified: { forecasts: 1 },
  });
});

test("a rejected motion keeps nothing and hands back the votes", async () => {
  const { desk, store, cover } = setup();
  const council = votes(MagiVote.Reject, MagiVote.Approve, MagiVote.Reject);

  await cover();

  expect(await desk.forecast(draft, async () => council)).toEqual({
    ok: false,
    violations: [{ code: ForecastViolationCode.MotionRejected, council }],
  });
  expect(store.forecasts()).toEqual([]);
});

test("no vote is spent on a forecast the checks refuse", async () => {
  const { desk } = setup();
  const ratify = vi.fn();

  expect((await desk.forecast(draft, ratify)).ok).toBe(false);
  expect(ratify).not.toHaveBeenCalled();
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

function watching(audit = vi.fn()) {
  const store = memoryStore();
  const onChange = vi.fn();

  const desk = new ResearchDesk({
    store,
    marketData: { candles: async () => [ANCHOR_BAR] },
    fundamentals: { statements: async () => [] },
    auditor: async () => ({ audit }),
    onChange,
    now: () => AT_ANCHOR,
  });

  // Every falsifier's vector is [1, 0].
  const embedder = {
    space: LOCAL_SPACE,
    embed: vi.fn(async (texts: readonly string[]) =>
      texts.map(() => Float32Array.of(1, 0))
    ),
  };

  return { store, desk, onChange, audit, embedder };
}

test("each falsifier is read against the news nearest it once, and an item that states it is a signal", async () => {
  const audit = vi.fn(async ({ quote }: { quote: string }) => ({
    model: "jev",
    supported: quote === "margins fell" ? 0.9 : 0.1,
  }));

  const { desk, onChange, embedder } = watching(audit);

  await desk.revise({
    symbol: TSMC,
    stance: ReportStance.Bullish,
    thesis: "Advanced nodes stay sold out.",
    falsifiers: ["Gross margin falls below 53%"],
  });
  onChange.mockClear();

  const records = [
    nearby("margins fell", 10),
    nearby("capex rose", 20),
    nearby("dividend set", 30),
    nearby("chip launch", 35),
    // cos 70° ≈ 0.34 lies below the floor.
    nearby("unrelated", 70),
  ];

  await desk.watch(TSMC, records, embedder);

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
  expect((await desk.coverage(TSMC)).signals).toEqual([
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

  audit.mockClear();
  onChange.mockClear();
  await desk.watch(TSMC, records, embedder);

  expect(audit).not.toHaveBeenCalled();
  expect(onChange).not.toHaveBeenCalled();
});

test("nothing is watched without falsifiers, an auditor, vectors in the embedder's space or a floor for it", async () => {
  const { desk, audit, embedder } = watching();

  await desk.watch(TSMC, [nearby("margins fell", 0)], embedder);

  await desk.revise({
    symbol: TSMC,
    stance: ReportStance.Bullish,
    thesis: "Advanced nodes stay sold out.",
    falsifiers: ["Gross margin falls below 53%"],
  });

  await desk.watch(
    TSMC,
    [nearby("margins fell", 0, "another-space")],
    embedder
  );
  await desk.watch(TSMC, [nearby("margins fell", 0, "another-space")], {
    ...embedder,
    space: "another-space",
  });

  expect(audit).not.toHaveBeenCalled();
  expect(embedder.embed).not.toHaveBeenCalled();
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
    fundamentals: { statements: async () => [] },
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
