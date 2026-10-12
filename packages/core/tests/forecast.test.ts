import { describe, expect, test } from "vite-plus/test";

import type { Candle } from "../src/candles.ts";
import {
  ForecastDirection,
  ForecastViolationCode,
  PlanResult,
  bandsBetween,
  baseRates,
  checkForecast,
  evidenceSide,
  forecastLean,
  forecastRecord,
  forecastTimeline,
  horizonMoves,
  judgeForecast,
  moveQuantile,
  readEvidence,
} from "../src/forecast.ts";
import type {
  Forecast,
  ForecastContext,
  ForecastDraft,
} from "../src/forecast.ts";
import type { Dividend } from "../src/fundamentals.ts";
import { Market } from "../src/market.ts";
import { ReportStance } from "../src/report.ts";
import { Stance } from "../src/sentiment.ts";

const TSMC = { market: Market.TW, symbol: "2330" };

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
    newerFinancials: null,
    taken: false,
    baseRates: null,
    support: () => null,
    ...patch,
  };
}

function forecast(patch: Partial<Forecast> = {}): Forecast {
  return {
    ...draft(),
    claims: [],
    baseRates: null,
    id: "f-1",
    createdAt: 0,
    anchor: ANCHOR,
    reportRevision: 1,
    motions: null,
    evidence: null,
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
const exDividend = (cashExDate: string, cash: number): Dividend => ({
  period: "115年",
  announced: null,
  cash,
  stock: 0,
  cashExDate,
  cashPaidOn: null,
  stockExDate: null,
});

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

  test("a report older than the newest quarter takes no forecast", () => {
    expect(
      checkForecast(draft(), context({ newerFinancials: "2026-09-30" }))
    ).toEqual([
      { code: ForecastViolationCode.ReportStale, periodEnd: "2026-09-30" },
    ]);
  });

  test("a claim whose quote says less than it asserts is refused", () => {
    const claim = {
      text: "Orders will double.",
      source: "Call",
      quote: "Demand is robust.",
    };

    expect(
      checkForecast(
        draft({ claims: [claim] }),
        context({ support: () => ({ model: "jev", supported: 0.05 }) })
      )
    ).toEqual([
      {
        code: ForecastViolationCode.ClaimUnsupported,
        claim: "Orders will double.",
        supported: 0.05,
      },
    ]);
    expect(
      checkForecast(
        draft({ claims: [claim] }),
        context({ support: () => ({ model: "jev", supported: 0.6 }) })
      )
    ).toEqual([]);
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

  test("a neutral forecast has no plan, and a directional one may go without", () => {
    expect(
      checkForecast(draft({ direction: ForecastDirection.Neutral }), context())
    ).toEqual([{ code: ForecastViolationCode.PlanUnexpected }]);

    expect(checkForecast(draft({ plan: null }), context())).toEqual([]);
  });

  test("a direction is the way the probabilities lean from history", () => {
    // The draft gives the band below the anchor 20% and the one above it 30%.
    const up = context({ baseRates: [0.25, 0.5, 0.25] });
    const down = context({ baseRates: [0.15, 0.5, 0.35] });
    const level = context({ baseRates: [0.2, 0.5, 0.3] });

    const short = {
      direction: ForecastDirection.Short,
      plan: null,
      contrary: "Stretched above its average.",
    };

    expect(checkForecast(draft(), up)).toEqual([]);
    expect(checkForecast(draft(short), down)).toEqual([]);

    expect(checkForecast(draft(), down)).toEqual([
      { code: ForecastViolationCode.LeanOpposed, lean: expect.closeTo(-0.1) },
    ]);

    expect(checkForecast(draft(short), up)).toEqual([
      { code: ForecastViolationCode.LeanOpposed, lean: expect.closeTo(0.1) },
    ]);

    expect(checkForecast(draft(), level)).toEqual([
      { code: ForecastViolationCode.LeanOpposed, lean: expect.closeTo(0) },
    ]);

    // Neutral says nothing of a lean, and neither does a listing with too little history.
    expect(
      checkForecast(
        draft({ direction: ForecastDirection.Neutral, plan: null }),
        down
      )
    ).toEqual([]);
  });

  test("a band with prices on both sides of the last close leans neither way", () => {
    const bands = [
      { probability: 40, low: null, high: 1010 },
      { probability: 60, low: 1010, high: null },
    ];

    // Only the upper band lies on one side of 1000, and it holds 10 points more than history.
    expect(forecastLean(bands, 1000, [0.5, 0.5])).toBeCloseTo(0.1);
    // Split at the last close, each band takes a side.
    expect(forecastLean(bands, 1010, [0.5, 0.5])).toBeCloseTo(0.2);
  });

  test("a band that starts at the last close lies above it, so weight moved out of it leans down", () => {
    const rates = [0.4, 0.3, 0.3];

    const bands = (edge: number) => [
      { probability: 45, low: null, high: edge },
      { probability: 15, low: edge, high: 1100 },
      { probability: 40, low: 1100, high: null },
    ];

    // History closes at or above 1000 six times in ten, and these probabilities 55 in 100: the
    // 10 points added far above do not make up for the 15 taken from just above.
    expect(forecastLean(bands(1000), 1000, rates)).toBeCloseTo(-0.1);
    // A middle band that reaches below the last close says nothing of its side.
    expect(forecastLean(bands(990), 1000, rates)).toBeCloseTo(0.05);
  });

  test("a modest rise and a modest fall each count on their own side", () => {
    const bands = (probabilities: number[]) => [
      { probability: probabilities[0], low: null, high: 950 },
      { probability: probabilities[1], low: 950, high: 1000 },
      { probability: probabilities[2], low: 1000, high: 1050 },
      { probability: probabilities[3], low: 1050, high: null },
    ];

    const rates = [0.2, 0.3, 0.3, 0.2];

    // Weight moved within a side, from a modest move to a large one, leans neither way.
    expect(forecastLean(bands([20, 30, 20, 30]), 1000, rates)).toBeCloseTo(0);
    expect(forecastLean(bands([30, 20, 30, 20]), 1000, rates)).toBeCloseTo(0);
    // Weight moved from just below the last close to just above it leans up.
    expect(forecastLean(bands([20, 20, 40, 20]), 1000, rates)).toBeCloseTo(0.2);
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

  test("cash that went ex inside the horizon is added back before the close and the plan are judged", () => {
    const bars = daily(
      { low: 995, high: 1010, close: 1005 },
      // 30 went ex on the second session: the bars fall by it with nothing lost.
      { low: 965, high: 985, close: 980 },
      { low: 960, high: 985, close: 975 }
    );

    const raw = judgeForecast(forecast(), bars, AFTER_HORIZON);

    // As traded the low of 965 is through the stop at 980, and the close in the bear's band.
    expect(raw).toMatchObject({ close: 975, distributed: 0, scenario: 0 });
    expect(raw?.plan?.result).toBe(PlanResult.HitStop);

    const judged = judgeForecast(forecast(), bars, AFTER_HORIZON, [
      exDividend("2026-10-01", 30),
      // Gone ex before the anchor and after the horizon, which change nothing.
      exDividend("2026-09-29", 10),
      exDividend("2026-10-05", 10),
    ]);

    // With 30 added back the close reads 1005, in the base band, and no low comes near the stop.
    expect(judged).toMatchObject({ close: 975, distributed: 30, scenario: 1 });
    expect(judged?.plan?.result).toBe(PlanResult.Expired);
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

describe("forecastTimeline", () => {
  const midnight = (date: string) =>
    Date.parse(`${date}T00:00:00+08:00`) / 1000;

  test("puts sessions that traded on their bars and the rest on the weekdays after", () => {
    // The anchor's bar and one session: the next two skip the weekend of 10-03.
    expect(
      forecastTimeline(forecast(), daily({ low: 995, high: 1010, close: 1005 }))
    ).toEqual(
      ["2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02"].map(midnight)
    );

    expect(forecastTimeline(forecast({ horizon: 5 }), daily())).toEqual(
      [
        "2026-09-29",
        "2026-09-30",
        "2026-10-01",
        "2026-10-02",
        "2026-10-05",
        "2026-10-06",
      ].map(midnight)
    );
  });

  test("follows the bars when a holiday moved a session", () => {
    const bars = [
      ...daily(),
      bar("2026-10-01", { low: 995, high: 1010, close: 1005 }),
    ];

    expect(forecastTimeline(forecast(), bars)).toEqual(
      ["2026-09-29", "2026-10-01", "2026-10-02", "2026-10-05"].map(midnight)
    );
  });

  test("is empty once the bars start after the anchor", () => {
    expect(
      forecastTimeline(
        forecast(),
        daily({ low: 995, high: 1010, close: 1005 }).slice(1)
      )
    ).toEqual([]);
  });
});

test("forecastRecord sums up what settled and how well the probabilities held", () => {
  const settled = (scenario: number, r: number | null) =>
    forecast({
      outcome: {
        date: "2026-10-02",
        close: 1000,
        distributed: 0,
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
    skill: null,
  });
});

/** Daily bars whose closes are given, one a day from 2026-01-01. */
const closes = (prices: number[]) =>
  prices.map((close, index) =>
    bar(Temporal.PlainDate.from("2026-01-01").add({ days: index }).toString(), {
      low: close,
      high: close,
      close,
    })
  );

describe("base rates", () => {
  test("a horizon's moves are every close over the close that many sessions before", () => {
    expect(horizonMoves(Market.TW, closes([100, 110, 121, 100]), 2)).toEqual([
      1.21,
      100 / 110,
    ]);
    expect(horizonMoves(Market.TW, closes([100, 110]), 2)).toEqual([]);
  });

  test("cash that went ex inside a move counts with its later close", () => {
    // 5 went ex on the third bar's day: the moves that span it carry it, the one after does not.
    const moves = horizonMoves(Market.TW, closes([100, 100, 95, 95, 95]), 2, [
      exDividend("2026-01-03", 5),
    ]);

    expect(moves).toEqual([1, 1, 1]);
  });

  test("bands between edges hold every price once, the lowest and highest left open", () => {
    expect(bandsBetween([950, 1050])).toEqual([
      { low: null, high: 950 },
      { low: 950, high: 1050 },
      { low: 1050, high: null },
    ]);
    expect(bandsBetween([])).toEqual([{ low: null, high: null }]);
  });

  test("the share of moves that land in each band, carried from the anchor's price", () => {
    // Of 100 moves, 10 fall 10%, 60 stay and 30 rise 10%.
    const moves = [
      ...Array.from({ length: 10 }, () => 0.9),
      ...Array.from({ length: 60 }, () => 1),
      ...Array.from({ length: 30 }, () => 1.1),
    ];

    expect(baseRates(moves, 1000, bandsBetween([950, 1050]))).toEqual([
      0.1, 0.6, 0.3,
    ]);
    // A band holds its low and not its high.
    expect(baseRates(moves, 1000, bandsBetween([900, 1000]))).toEqual([
      0, 0.1, 0.9,
    ]);
  });

  test("too few moves give no base rates", () => {
    expect(
      baseRates(
        Array.from({ length: 59 }, () => 1),
        1000,
        bandsBetween([950])
      )
    ).toBeNull();
  });

  test("a quantile reads between the moves around it", () => {
    const moves = [1.2, 0.8, 1, 0.9, 1.1];

    expect(moveQuantile(moves, 0)).toBe(0.8);
    expect(moveQuantile(moves, 0.5)).toBe(1);
    expect(moveQuantile(moves, 1)).toBe(1.2);
    expect(moveQuantile(moves, 0.125)).toBeCloseTo(0.85);
  });
});

test("forecastRecord measures settled forecasts against the base rates of their own bands", () => {
  const settled = (
    scenario: number,
    brier: number,
    baseRates: number[] | null
  ) =>
    forecast({
      baseRates,
      outcome: {
        date: "2026-10-02",
        close: 1000,
        distributed: 0,
        scenario,
        brier,
        plan: null,
      },
    });

  const { skill } = forecastRecord([
    // History alone gave the band that held 60%: its own Brier is 0.26.
    settled(1, 0.13, [0.1, 0.6, 0.3]),
    // And here 30%: 0.01 + 0.36 + 0.49.
    settled(2, 0.43, [0.1, 0.6, 0.3]),
    // Kept before base rates were measured, so it has no part in the skill.
    settled(1, 1.5, null),
    // Not settled yet.
    forecast({ baseRates: [0.2, 0.5, 0.3] }),
  ]);

  expect(skill?.forecasts).toBe(2);
  expect(skill?.brier).toBeCloseTo(0.28);
  expect(skill?.baseBrier).toBeCloseTo((0.26 + 0.86) / 2);
  expect(skill?.skill).toBeCloseTo(1 - 0.28 / 0.56);
});

test("the record counts the scenarios a vote carried against what history expects of them", () => {
  const council = (carried: boolean) => ({ carried, votes: [] });

  const settled = (scenario: number) => ({
    date: SESSIONS[2],
    close: 1000,
    distributed: 0,
    scenario,
    brier: 0.5,
    plan: null,
  });

  const voted = {
    baseRates: [0.2, 0.5, 0.3],
    motions: [council(false), council(true), council(true)],
  };

  const record = forecastRecord([
    // The close landed in one of the two bands carried.
    forecast({ ...voted, outcome: settled(2) }),
    // And in neither of them.
    forecast({ ...voted, id: "f-2", outcome: settled(0) }),
    // An open forecast and one no vote was held on take no part.
    forecast({ ...voted, id: "f-3" }),
    forecast({ id: "f-4", baseRates: [0.2, 0.5, 0.3], outcome: settled(1) }),
  ]);

  expect(record.motions).toEqual({
    calls: 4,
    held: 1,
    expected: expect.closeTo(1.6),
  });
  expect(forecastRecord([forecast()]).motions).toBeNull();
});

/** A reading with all of its weight on one level. */
const stanceOn = (level: Stance) => ({
  [Stance.Negative]: 0,
  [Stance.LeanNegative]: 0,
  [Stance.Neutral]: 0,
  [Stance.LeanPositive]: 0,
  [Stance.Positive]: 0,
  [level]: 1,
});

const read = (level: Stance) => ({ model: "jev", stance: stanceOn(level) });

test("several facts read as one are the mean of their readings, and none read is no reading", () => {
  expect(readEvidence([])).toBeNull();

  expect(
    readEvidence([
      read(Stance.Positive),
      read(Stance.Positive),
      read(Stance.Neutral),
      read(Stance.LeanNegative),
    ])
  ).toEqual({
    model: "jev",
    facts: 4,
    stance: {
      [Stance.Negative]: 0,
      [Stance.LeanNegative]: 0.25,
      [Stance.Neutral]: 0.25,
      [Stance.LeanPositive]: 0,
      [Stance.Positive]: 0.5,
    },
  });
});

test("facts that cancel out call no side, and facts that lean call theirs", () => {
  const evidence = (...levels: Stance[]) => {
    const reading = readEvidence(levels.map(read));

    if (!reading) throw new Error("No fact was read");

    return reading;
  };

  expect(evidenceSide(evidence(Stance.Positive, Stance.Neutral))).toBe(1);
  expect(evidenceSide(evidence(Stance.Negative, Stance.LeanNegative))).toBe(-1);
  // A mean of 0.125 is under the line.
  expect(
    evidenceSide(
      evidence(
        Stance.LeanPositive,
        Stance.Neutral,
        Stance.Neutral,
        Stance.Neutral
      )
    )
  ).toBe(0);
  expect(evidenceSide(evidence(Stance.Positive, Stance.Negative))).toBe(0);
});

test("the record counts the side the facts read towards against what history expects of its bands", () => {
  const settled = (scenario: number) => ({
    date: SESSIONS[2],
    close: 1000,
    distributed: 0,
    scenario,
    brier: 0.5,
    plan: null,
  });

  const facts = (level: Stance) => readEvidence([read(level)]);
  const baseRates = [0.2, 0.5, 0.3];

  const record = forecastRecord([
    // Read up, and the close landed in the band above the anchor.
    forecast({
      baseRates,
      evidence: facts(Stance.Positive),
      outcome: settled(2),
    }),
    // Read up, and it landed in the band that holds the anchor.
    forecast({
      id: "f-2",
      baseRates,
      evidence: facts(Stance.Positive),
      outcome: settled(1),
    }),
    // Read down, and it landed below.
    forecast({
      id: "f-3",
      baseRates,
      evidence: facts(Stance.Negative),
      outcome: settled(0),
    }),
    // Facts that lean neither way, an open forecast and one nobody read call nothing.
    forecast({
      id: "f-4",
      baseRates,
      evidence: facts(Stance.Neutral),
      outcome: settled(2),
    }),
    forecast({ id: "f-5", baseRates, evidence: facts(Stance.Positive) }),
    forecast({ id: "f-6", baseRates, outcome: settled(2) }),
  ]);

  // Two calls on the band above, which history gives 0.3, and one on the band below, 0.2.
  expect(record.evidence).toEqual({
    calls: 3,
    held: 2,
    expected: expect.closeTo(0.8),
  });
  expect(forecastRecord([forecast()]).evidence).toBeNull();
});
