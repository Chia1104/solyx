import { expect, test, vi } from "vite-plus/test";

import { Interval } from "../src/candles.ts";
import type { Candle } from "../src/candles.ts";
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
  const store = memoryStore();

  const desk = new ResearchDesk({
    store,
    marketData: { candles },
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

  return { desk, store, clock, bars, candles, onChange, cover };
}

test("a revision is kept and numbered after the last", () => {
  const { desk, store, cover, onChange } = setup();

  cover();

  expect(
    desk.revise({ symbol: TSMC, stance: ReportStance.Neutral })
  ).toMatchObject({
    ok: true,
    report: { revision: 2, stance: ReportStance.Neutral },
  });
  expect(store.report(TSMC)?.revision).toBe(2);
  expect(onChange).toHaveBeenCalledTimes(2);
});

test("a refused revision keeps nothing", () => {
  const { desk, store, onChange } = setup();

  expect(desk.revise({ symbol: TSMC }).ok).toBe(false);
  expect(store.report(TSMC)).toBeUndefined();
  expect(onChange).not.toHaveBeenCalled();
});

test("a forecast is stamped with the newest daily bar and the report it was made under", async () => {
  const { desk, cover, candles } = setup();

  cover();

  expect(await desk.forecast(draft)).toEqual({
    ok: true,
    forecast: {
      ...draft,
      id: "f-1",
      createdAt: AT_ANCHOR,
      anchor: { date: "2026-09-29", price: 1000 },
      reportRevision: 1,
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

  cover();
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

  cover();

  const first = await desk.forecast({ ...draft, id: "run-1" });

  candles.mockClear();

  expect(await desk.forecast({ ...draft, id: "run-1" })).toEqual(first);
  expect(store.forecasts()).toHaveLength(1);
  expect(candles).not.toHaveBeenCalled();
});

test("a listing without bars cannot anchor a forecast", async () => {
  const { desk, cover, bars } = setup();

  cover();
  bars.daily = [];

  await expect(desk.forecast(draft)).rejects.toThrow(
    "TW:2330 has no daily bars"
  );
});

test("coverage settles a forecast once its horizon has closed, and keeps the outcome", async () => {
  const { desk, store, cover, clock, bars, candles, onChange } = setup();

  cover();
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

  cover();
  await desk.forecast(draft);
  candles.mockRejectedValue(new Error("No source covers TW"));

  expect(await desk.coverage(TSMC)).toMatchObject({
    report: { revision: 1 },
    forecasts: [{ id: "f-1", outcome: null }],
  });
});

test("the track record settles every listing's forecasts", async () => {
  const { desk, cover, clock, bars } = setup();

  cover();
  await desk.forecast(draft);

  clock.now = AFTER_HORIZON;
  bars.daily = [ANCHOR_BAR, ...LATER_BARS];

  expect(await desk.trackRecord()).toMatchObject({ forecasts: 1, settled: 1 });
});
