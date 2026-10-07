import { expect, test, vi } from "vite-plus/test";

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
import { ReportStance } from "../src/report.ts";
import type { Report } from "../src/report.ts";
import { ResearchDesk } from "../src/research.ts";
import type { ResearchStore } from "../src/research.ts";

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
