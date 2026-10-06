import { describe, expect, test } from "vite-plus/test";

import type { Candle } from "../src/candles.ts";
import {
  ForecastDirection,
  ForecastViolationCode,
  PlanResult,
  checkForecast,
  forecastRecord,
  judgeForecast,
} from "../src/forecast.ts";
import type {
  Forecast,
  ForecastContext,
  ForecastDraft,
} from "../src/forecast.ts";
import { InstrumentKind, Market } from "../src/market.ts";
import { ReportStance } from "../src/report.ts";

const TSMC = { market: Market.TW, symbol: "2330", kind: InstrumentKind.Stock };

const ANCHOR = { date: "2026-09-29", price: 1000 };

// The three sessions after the anchor; the first weekend falls between the last two.
const SESSIONS = ["2026-09-30", "2026-10-01", "2026-10-02"];

const AFTER_HORIZON = new Date("2026-10-02T14:00:00+08:00");

function draft(patch: Partial<ForecastDraft> = {}): ForecastDraft {
  return {
    instrument: TSMC,
    horizon: 3,
    direction: ForecastDirection.Long,
    plan: { entry: 1000, stop: 980, target: 1040 },
    scenarios: [
      {
        label: "Bear",
        probability: 20,
        low: null,
        high: 990,
        path: [{ session: 3, price: 970 }],
      },
      {
        label: "Base",
        probability: 50,
        low: 990,
        high: 1030,
        path: [{ session: 3, price: 1010 }],
      },
      {
        label: "Bull",
        probability: 30,
        low: 1030,
        high: null,
        path: [
          { session: 1, price: 1015 },
          { session: 3, price: 1050 },
        ],
      },
    ],
    rationale: "Holds the 20-day average.",
    claims: [],
    contrary: null,
    ...patch,
  };
}

function context(patch: Partial<ForecastContext> = {}): ForecastContext {
  return {
    anchor: ANCHOR,
    stance: ReportStance.Bullish,
    taken: false,
    ...patch,
  };
}

function forecast(patch: Partial<Forecast> = {}): Forecast {
  return {
    ...draft(),
    id: "f-1",
    createdAt: 0,
    anchor: ANCHOR,
    reportRevision: 1,
    outcome: null,
    ...patch,
  };
}

function bar(
  date: string,
  { low, high, close }: { low: number; high: number; close: number }
): Candle {
  return {
    time: Date.parse(`${date}T00:00:00+08:00`) / 1000,
    open: close,
    high,
    low,
    close,
    volume: 1000,
  };
}

/** The anchor's bar and then one bar per session. */
function daily(
  ...sessions: { low: number; high: number; close: number }[]
): Candle[] {
  return [
    bar(ANCHOR.date, { low: 990, high: 1005, close: ANCHOR.price }),
    ...sessions.map((prices, index) => bar(SESSIONS[index], prices)),
  ];
}

describe("checkForecast", () => {
  test("a well-formed forecast under a report passes", () => {
    expect(checkForecast(draft(), context())).toEqual([]);
  });

  test("a listing without a report takes no forecast", () => {
    expect(checkForecast(draft(), context({ stance: null }))).toEqual([
      { code: ForecastViolationCode.NoReport },
    ]);
  });

  test("a session takes one forecast", () => {
    expect(checkForecast(draft(), context({ taken: true }))).toEqual([
      { code: ForecastViolationCode.AlreadyForecast, date: ANCHOR.date },
    ]);
  });

  test("going against the report's stance needs a reason", () => {
    const bearish = context({ stance: ReportStance.Bearish });

    expect(checkForecast(draft(), bearish)).toEqual([
      {
        code: ForecastViolationCode.ContraryUnexplained,
        stance: ReportStance.Bearish,
      },
    ]);
    expect(
      checkForecast(draft({ contrary: "Oversold into support." }), bearish)
    ).toEqual([]);
  });

  test("probabilities add up to 100", () => {
    const scenarios = draft().scenarios.with(0, {
      ...draft().scenarios[0],
      probability: 30,
    });

    expect(checkForecast(draft({ scenarios }), context())).toEqual([
      { code: ForecastViolationCode.ProbabilitySum, sum: 110 },
    ]);
  });

  test("bands hold every price once, in whatever order they are given", () => {
    const [bear, base, bull] = draft().scenarios;

    expect(
      checkForecast(draft({ scenarios: [bull, bear, base] }), context())
    ).toEqual([]);

    expect(
      checkForecast(
        draft({ scenarios: [bear, { ...base, low: 995 }, bull] }),
        context()
      )
    ).toEqual([{ code: ForecastViolationCode.BandsBroken }]);
  });

  test("a path climbs through the sessions to the horizon and ends in its band", () => {
    const [bear, base, bull] = draft().scenarios;

    expect(
      checkForecast(
        draft({
          scenarios: [
            { ...bear, path: [{ session: 2, price: 970 }] },
            { ...base, path: [{ session: 3, price: 1035 }] },
            bull,
          ],
        }),
        context()
      )
    ).toEqual([
      { code: ForecastViolationCode.PathBroken, scenario: 0 },
      { code: ForecastViolationCode.PathOutsideBand, scenario: 1, price: 1035 },
    ]);
  });

  test("a neutral forecast has no plan, and a directional one needs it", () => {
    expect(
      checkForecast(draft({ direction: ForecastDirection.Neutral }), context())
    ).toEqual([{ code: ForecastViolationCode.PlanUnexpected }]);

    expect(checkForecast(draft({ plan: null }), context())).toEqual([
      { code: ForecastViolationCode.PlanMissing },
    ]);
  });

  test("plan prices sit on the listing's tick", () => {
    expect(
      checkForecast(
        draft({ plan: { entry: 1002, stop: 980, target: 1040 } }),
        context()
      )
    ).toEqual([
      { code: ForecastViolationCode.InvalidPrice, price: 1002, tick: 5 },
    ]);
  });

  test("a short's stop lies above its entry and its target below", () => {
    const short = context({ stance: ReportStance.Bearish });

    expect(
      checkForecast(
        draft({
          direction: ForecastDirection.Short,
          plan: { entry: 1000, stop: 980, target: 1040 },
        }),
        short
      )
    ).toEqual([
      { code: ForecastViolationCode.StopWrongSide },
      { code: ForecastViolationCode.TargetWrongSide },
    ]);
  });

  test("the target pays at least what the stop risks", () => {
    expect(
      checkForecast(
        draft({ plan: { entry: 1000, stop: 980, target: 1010 } }),
        context()
      )
    ).toEqual([
      { code: ForecastViolationCode.RewardBelowRisk, reward: 10, risk: 20 },
    ]);

    // 0.2 against 0.2 on a 0.1 tick, where floating point makes the reward the smaller.
    expect(90.1 - 89.9).toBeLessThan(90.3 - 90.1);
    expect(
      checkForecast(
        draft({
          direction: ForecastDirection.Short,
          plan: { entry: 90.1, stop: 90.3, target: 89.9 },
          scenarios: [
            {
              label: "Down",
              probability: 40,
              low: null,
              high: 90,
              path: [{ session: 3, price: 89 }],
            },
            {
              label: "Up",
              probability: 60,
              low: 90,
              high: null,
              path: [{ session: 3, price: 91 }],
            },
          ],
        }),
        context({ stance: ReportStance.Bearish })
      )
    ).toEqual([]);
  });
});

describe("judgeForecast", () => {
  test("stays open until the horizon's session closes", () => {
    const bars = daily(
      { low: 995, high: 1010, close: 1005 },
      { low: 1000, high: 1020, close: 1015 },
      { low: 1010, high: 1030, close: 1020 }
    );

    expect(judgeForecast(forecast(), bars.slice(0, 3), AFTER_HORIZON)).toBe(
      null
    );
    expect(
      judgeForecast(forecast(), bars, new Date("2026-10-02T10:00:00+08:00"))
    ).toBe(null);
    expect(judgeForecast(forecast(), bars, AFTER_HORIZON)).not.toBe(null);
  });

  test("cannot count sessions once the bars start after the anchor", () => {
    const bars = daily(
      { low: 995, high: 1010, close: 1005 },
      { low: 1000, high: 1020, close: 1015 },
      { low: 1010, high: 1030, close: 1020 }
    );

    expect(judgeForecast(forecast(), bars.slice(1), AFTER_HORIZON)).toBe(null);
  });

  test("scores the probabilities against the band that held the close", () => {
    const outcome = judgeForecast(
      forecast(),
      daily(
        { low: 995, high: 1010, close: 1005 },
        { low: 1000, high: 1020, close: 1015 },
        { low: 1010, high: 1035, close: 1030 }
      ),
      AFTER_HORIZON
    );

    // A band holds its low and not its high, so 1030 is the bull's.
    expect(outcome).toMatchObject({
      date: "2026-10-02",
      close: 1030,
      scenario: 2,
    });
    expect(outcome?.brier).toBeCloseTo(0.2 ** 2 + 0.5 ** 2 + 0.7 ** 2);
  });

  test("a plan that enters and then reaches its target pays its reward in R", () => {
    const outcome = judgeForecast(
      forecast(),
      daily(
        { low: 995, high: 1010, close: 1005 },
        { low: 1000, high: 1045, close: 1040 },
        { low: 1030, high: 1050, close: 1045 }
      ),
      AFTER_HORIZON
    );

    expect(outcome?.plan).toEqual({
      result: PlanResult.HitTarget,
      entered: 1,
      exited: 2,
      r: 2,
    });
  });

  test("the bar that enters can stop the plan but not reach its target", () => {
    const entry = { entry: 990, stop: 980, target: 1010 };

    expect(
      judgeForecast(
        forecast({ plan: entry }),
        daily(
          { low: 985, high: 1015, close: 1010 },
          { low: 1000, high: 1008, close: 1005 },
          { low: 1000, high: 1008, close: 1000 }
        ),
        AFTER_HORIZON
      )?.plan
    ).toEqual({ result: PlanResult.Expired, entered: 1, exited: 3, r: 1 });

    expect(
      judgeForecast(
        forecast({ plan: entry }),
        daily(
          { low: 975, high: 1015, close: 1010 },
          { low: 1000, high: 1008, close: 1005 },
          { low: 1000, high: 1008, close: 1000 }
        ),
        AFTER_HORIZON
      )?.plan
    ).toMatchObject({ result: PlanResult.HitStop, exited: 1, r: -1 });
  });

  test("a later bar that trades at both the stop and the target counts as the stop", () => {
    expect(
      judgeForecast(
        forecast(),
        daily(
          { low: 995, high: 1010, close: 1005 },
          { low: 975, high: 1045, close: 1040 },
          { low: 1030, high: 1050, close: 1045 }
        ),
        AFTER_HORIZON
      )?.plan
    ).toMatchObject({ result: PlanResult.HitStop, entered: 1, exited: 2 });
  });

  test("a gap past the entry still enters, and a price that never comes to it does not", () => {
    const breakout = { entry: 1020, stop: 1000, target: 1060 };

    expect(
      judgeForecast(
        forecast({ plan: breakout }),
        daily(
          { low: 1025, high: 1035, close: 1030 },
          { low: 1025, high: 1040, close: 1035 },
          { low: 1030, high: 1045, close: 1040 }
        ),
        AFTER_HORIZON
      )?.plan
    ).toEqual({ result: PlanResult.Expired, entered: 1, exited: 3, r: 1 });

    expect(
      judgeForecast(
        forecast({ plan: breakout }),
        daily(
          { low: 995, high: 1010, close: 1005 },
          { low: 1000, high: 1015, close: 1010 },
          { low: 1000, high: 1015, close: 1005 }
        ),
        AFTER_HORIZON
      )?.plan
    ).toEqual({
      result: PlanResult.NotEntered,
      entered: null,
      exited: null,
      r: null,
    });
  });

  test("a short gains as the price falls", () => {
    expect(
      judgeForecast(
        forecast({
          direction: ForecastDirection.Short,
          plan: { entry: 1000, stop: 1020, target: 960 },
        }),
        daily(
          { low: 990, high: 1005, close: 995 },
          { low: 955, high: 995, close: 960 },
          { low: 950, high: 965, close: 955 }
        ),
        AFTER_HORIZON
      )?.plan
    ).toEqual({ result: PlanResult.HitTarget, entered: 1, exited: 2, r: 2 });
  });

  test("a neutral forecast is scored on its scenarios alone", () => {
    expect(
      judgeForecast(
        forecast({ direction: ForecastDirection.Neutral, plan: null }),
        daily(
          { low: 995, high: 1010, close: 1005 },
          { low: 1000, high: 1015, close: 1010 },
          { low: 1000, high: 1015, close: 1005 }
        ),
        AFTER_HORIZON
      )
    ).toMatchObject({ scenario: 1, plan: null });
  });
});

test("forecastRecord sums up what settled and how well the probabilities held", () => {
  const settled = (scenario: number, r: number | null) =>
    forecast({
      outcome: {
        date: "2026-10-02",
        close: 1000,
        scenario,
        brier: scenario === 1 ? 0.38 : 0.78,
        plan:
          r === null
            ? {
                result: PlanResult.NotEntered,
                entered: null,
                exited: null,
                r,
              }
            : {
                result: r > 0 ? PlanResult.HitTarget : PlanResult.HitStop,
                entered: 1,
                exited: 2,
                r,
              },
      },
    });

  const record = forecastRecord([
    settled(1, 2),
    settled(1, -1),
    settled(2, null),
    forecast(),
  ]);

  expect(record).toMatchObject({
    forecasts: 4,
    settled: 3,
    plans: {
      [PlanResult.NotEntered]: 1,
      [PlanResult.HitTarget]: 1,
      [PlanResult.HitStop]: 1,
      [PlanResult.Expired]: 0,
    },
    meanR: 0.5,
  });
  expect(record.brier).toBeCloseTo((0.38 + 0.38 + 0.78) / 3);

  // Three forecasts each gave 20, 50 and 30: the 50 held twice and the 30 once.
  expect(record.calibration).toEqual([
    { from: 0, to: 20, scenarios: 0, held: 0 },
    { from: 20, to: 40, scenarios: 6, held: 1 },
    { from: 40, to: 60, scenarios: 3, held: 2 },
    { from: 60, to: 80, scenarios: 0, held: 0 },
    { from: 80, to: 100, scenarios: 0, held: 0 },
  ]);
});

test("forecastRecord has no means before anything settles", () => {
  expect(forecastRecord([forecast()])).toMatchObject({
    settled: 0,
    brier: null,
    meanR: null,
  });
});
