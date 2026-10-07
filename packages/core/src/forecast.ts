import { countBy, meanBy, range, sortBy, sumBy } from "es-toolkit";
import * as z from "zod";

import { candleDate } from "./candles.ts";
import type { Candle } from "./candles.ts";
import { exchangeMidnight, instrumentSchema, shiftDate } from "./market.ts";
import {
  ReportStance,
  claimSchema,
  proseSchema,
  unsupportedClaims,
} from "./report.ts";
import type { AuditedClaim, Claim, ClaimSupport } from "./report.ts";
import { isOnTick, tickSize } from "./risk.ts";
import { regularHours } from "./session.ts";

export const ForecastDirection = {
  Long: "long",
  Short: "short",
  Neutral: "neutral",
} as const;

export type ForecastDirection =
  (typeof ForecastDirection)[keyof typeof ForecastDirection];

/** The furthest a forecast may look, in sessions after its anchor. */
export const MAX_HORIZON = 20;

const priceSchema = z.number().positive();

const forecastPlanSchema = z.object({
  entry: priceSchema,
  stop: priceSchema,
  target: priceSchema,
});

export type ForecastPlan = z.infer<typeof forecastPlanSchema>;

const forecastScenarioSchema = z.object({
  label: proseSchema(40),
  /** Whole percent. */
  probability: z.number().int().min(0).max(100),
  /** The band it expects the horizon's close in, from `low` up to `high`; `null` leaves that side open. */
  low: priceSchema.nullable(),
  high: priceSchema.nullable(),
  /** The closes it expects on the way, each at a session counted from the anchor. */
  path: z
    .array(z.object({ session: z.number().int().min(1), price: priceSchema }))
    .min(1)
    .max(5),
});

export type ForecastScenario = z.infer<typeof forecastScenarioSchema>;

/** Checks structure only; `checkForecast` owns the rules so violations read as domain messages. */
export const forecastDraftSchema = z.object({
  instrument: instrumentSchema,
  /** Sessions after the anchor until it settles. */
  horizon: z.number().int().min(1).max(MAX_HORIZON),
  direction: z.enum(ForecastDirection),
  /** The trade it would take; `null` when neutral. */
  plan: forecastPlanSchema.nullable(),
  scenarios: z.array(forecastScenarioSchema).min(2).max(4),
  rationale: proseSchema(2_000),
  claims: z.array(claimSchema).max(8),
  /** Why it goes against the report's stance; `null` when it goes with it. */
  contrary: proseSchema(500).nullable(),
});

export type ForecastDraft = z.infer<typeof forecastDraftSchema>;

/** The newest daily bar when a forecast was made, which its sessions count from. */
export interface ForecastAnchor {
  /** Exchange-local date, `YYYY-MM-DD`. */
  date: string;
  /** The bar's close, or its last price while its session ran. */
  price: number;
}

export const PlanResult = {
  /** The price never came to the entry. */
  NotEntered: "not-entered",
  HitTarget: "hit-target",
  HitStop: "hit-stop",
  /** Entered and still open at the horizon's close. */
  Expired: "expired",
} as const;

export type PlanResult = (typeof PlanResult)[keyof typeof PlanResult];

export interface PlanOutcome {
  result: PlanResult;
  /** The sessions it entered and left on, counted from the anchor; an expired plan leaves on the horizon's. */
  entered: number | null;
  exited: number | null;
  /** What it made in units of the risk from entry to stop; `null` when it never entered. */
  r: number | null;
}

export interface ForecastOutcome {
  /** Exchange-local date, `YYYY-MM-DD`, of the horizon's session. */
  date: string;
  close: number;
  /** Index of the scenario whose band held the close. */
  scenario: number;
  /** Squared error of the probabilities against what happened: 0 when sure and right, 2 when sure and wrong. */
  brier: number;
  /** `null` for a forecast without a plan. */
  plan: PlanOutcome | null;
}

/** A forecast as kept: nothing but its outcome changes once it is made. */
export interface Forecast extends ForecastDraft {
  claims: AuditedClaim[];
  id: string;
  /** Epoch ms. */
  createdAt: number;
  anchor: ForecastAnchor;
  /** The report revision it was made under. */
  reportRevision: number;
  /** `null` until its horizon's session closes. */
  outcome: ForecastOutcome | null;
}

/** What the desk knows as a forecast is made. */
export interface ForecastContext {
  anchor: ForecastAnchor;
  /** The stance of the listing's report; `null` while it has none. */
  stance: ReportStance | null;
  /** The last day of a quarter published since the report was revised; `null` when the report is current. */
  newerFinancials: string | null;
  /** Whether the listing already has a forecast anchored on this session. */
  taken: boolean;
  /** The reading each of the draft's claims was given; `null` for one that was not read. */
  support: (claim: Claim) => ClaimSupport | null;
}

export const ForecastViolationCode = {
  NoReport: "no-report",
  ReportStale: "report-stale",
  AlreadyForecast: "already-forecast",
  ContraryUnexplained: "contrary-unexplained",
  ProbabilitySum: "probability-sum",
  BandsBroken: "bands-broken",
  PathBroken: "path-broken",
  PathOutsideBand: "path-outside-band",
  PlanMissing: "plan-missing",
  PlanUnexpected: "plan-unexpected",
  InvalidPrice: "invalid-price",
  StopWrongSide: "stop-wrong-side",
  TargetWrongSide: "target-wrong-side",
  RewardBelowRisk: "reward-below-risk",
  ClaimUnsupported: "claim-unsupported",
} as const;

export type ForecastViolationCode =
  (typeof ForecastViolationCode)[keyof typeof ForecastViolationCode];

/** Carries the data behind a rejection, not text; presenters word it. */
export type ForecastViolation =
  | { code: typeof ForecastViolationCode.NoReport }
  | { code: typeof ForecastViolationCode.ReportStale; periodEnd: string }
  | { code: typeof ForecastViolationCode.AlreadyForecast; date: string }
  | {
      code: typeof ForecastViolationCode.ContraryUnexplained;
      stance: ReportStance;
    }
  | { code: typeof ForecastViolationCode.ProbabilitySum; sum: number }
  | { code: typeof ForecastViolationCode.BandsBroken }
  | { code: typeof ForecastViolationCode.PathBroken; scenario: number }
  | {
      code: typeof ForecastViolationCode.PathOutsideBand;
      scenario: number;
      price: number;
    }
  | { code: typeof ForecastViolationCode.PlanMissing }
  | { code: typeof ForecastViolationCode.PlanUnexpected }
  | {
      code: typeof ForecastViolationCode.InvalidPrice;
      price: number;
      tick: number;
    }
  | { code: typeof ForecastViolationCode.StopWrongSide }
  | { code: typeof ForecastViolationCode.TargetWrongSide }
  | {
      code: typeof ForecastViolationCode.RewardBelowRisk;
      reward: number;
      risk: number;
    }
  | {
      code: typeof ForecastViolationCode.ClaimUnsupported;
      claim: string;
      /** How likely its quote states it, from 0 to 1. */
      supported: number;
    };

// Prices on a tick grid differ by sums that floating point carries only nearly.
const PRICE_EPSILON = 1e-9;

/** Which way a plan gains: 1 as the price rises, -1 as it falls. */
const gainSign = (direction: ForecastDirection) =>
  direction === ForecastDirection.Short ? -1 : 1;

function inBand(
  price: number,
  { low, high }: Pick<ForecastScenario, "low" | "high">
): boolean {
  return (low === null || price >= low) && (high === null || price < high);
}

/** Whether the bands hold every price exactly once, so one scenario always comes true. */
function tilesEveryPrice(scenarios: readonly ForecastScenario[]): boolean {
  const bands = sortBy(scenarios, [(scenario) => scenario.low ?? 0]);

  return (
    bands[0].low === null &&
    bands.every((band, index) =>
      index === bands.length - 1
        ? band.high === null
        : band.high !== null && band.high === bands[index + 1].low
    )
  );
}

function opposes(direction: ForecastDirection, stance: ReportStance): boolean {
  return (
    (direction === ForecastDirection.Long && stance === ReportStance.Bearish) ||
    (direction === ForecastDirection.Short && stance === ReportStance.Bullish)
  );
}

/** Deterministic checks before a forecast is kept. An empty result means it may be. */
export function checkForecast(
  draft: ForecastDraft,
  context: ForecastContext
): ForecastViolation[] {
  const violations: ForecastViolation[] = [];
  const { instrument, horizon, direction, plan, scenarios } = draft;

  if (context.stance === null) {
    violations.push({ code: ForecastViolationCode.NoReport });
  } else {
    if (context.newerFinancials !== null) {
      violations.push({
        code: ForecastViolationCode.ReportStale,
        periodEnd: context.newerFinancials,
      });
    }

    if (opposes(direction, context.stance) && draft.contrary === null) {
      violations.push({
        code: ForecastViolationCode.ContraryUnexplained,
        stance: context.stance,
      });
    }
  }

  if (context.taken) {
    violations.push({
      code: ForecastViolationCode.AlreadyForecast,
      date: context.anchor.date,
    });
  }

  const sum = sumBy(scenarios, (scenario) => scenario.probability);

  if (sum !== 100) {
    violations.push({ code: ForecastViolationCode.ProbabilitySum, sum });
  }

  if (!tilesEveryPrice(scenarios)) {
    violations.push({ code: ForecastViolationCode.BandsBroken });
  }

  scenarios.forEach(({ path, ...band }, scenario) => {
    const end = path[path.length - 1];

    const ascends = path.every(
      (point, index) => index === 0 || point.session > path[index - 1].session
    );

    if (!ascends || end.session !== horizon) {
      violations.push({ code: ForecastViolationCode.PathBroken, scenario });
    }

    if (!inBand(end.price, band)) {
      violations.push({
        code: ForecastViolationCode.PathOutsideBand,
        scenario,
        price: end.price,
      });
    }
  });

  for (const weak of unsupportedClaims(draft.claims, context.support)) {
    violations.push({ code: ForecastViolationCode.ClaimUnsupported, ...weak });
  }

  if (direction === ForecastDirection.Neutral) {
    if (plan) violations.push({ code: ForecastViolationCode.PlanUnexpected });

    return violations;
  }

  if (!plan) {
    violations.push({ code: ForecastViolationCode.PlanMissing });

    return violations;
  }

  for (const price of [plan.entry, plan.stop, plan.target]) {
    const tick = tickSize(instrument, price);

    if (!isOnTick(price, tick)) {
      violations.push({
        code: ForecastViolationCode.InvalidPrice,
        price,
        tick,
      });
    }
  }

  const sign = gainSign(direction);
  const risk = (plan.entry - plan.stop) * sign;
  const reward = (plan.target - plan.entry) * sign;

  if (risk <= 0) {
    violations.push({ code: ForecastViolationCode.StopWrongSide });
  }

  if (reward <= 0) {
    violations.push({ code: ForecastViolationCode.TargetWrongSide });
  }

  if (risk > 0 && reward > 0 && reward + PRICE_EPSILON < risk) {
    violations.push({
      code: ForecastViolationCode.RewardBelowRisk,
      reward,
      risk,
    });
  }

  return violations;
}

/** Whether a bar traded at `level`, which lies above the entry when `side` is 1 and below when -1. */
const reaches = (bar: Candle, level: number, side: number) =>
  side > 0 ? bar.high >= level : bar.low <= level;

/**
 * Replays a plan over the horizon's bars. A plan counts as filled at its entry once the price
 * comes to it, a gap past it included. Daily bars hide the order of a session's prices, so every
 * tie goes against the plan: the bar that enters can stop it but not reach its target, and a later
 * bar that trades at both counts as the stop.
 */
function replayPlan(
  direction: ForecastDirection,
  plan: ForecastPlan,
  anchorPrice: number,
  sessions: readonly Candle[]
): PlanOutcome {
  const sign = gainSign(direction);
  const risk = (plan.entry - plan.stop) * sign;
  const rAt = (price: number) => ((price - plan.entry) * sign) / risk;

  let entered: number | null = null;
  let before = anchorPrice;

  for (const [index, bar] of sessions.entries()) {
    const session = index + 1;
    const open = entered !== null;

    if (
      !open &&
      Math.min(before, bar.low) <= plan.entry &&
      plan.entry <= Math.max(before, bar.high)
    ) {
      entered = session;
    }

    if (entered !== null && reaches(bar, plan.stop, -sign)) {
      return { result: PlanResult.HitStop, entered, exited: session, r: -1 };
    }

    if (open && entered !== null && reaches(bar, plan.target, sign)) {
      return {
        result: PlanResult.HitTarget,
        entered,
        exited: session,
        r: rAt(plan.target),
      };
    }

    before = bar.close;
  }

  return entered === null
    ? { result: PlanResult.NotEntered, entered, exited: null, r: null }
    : {
        result: PlanResult.Expired,
        entered,
        exited: sessions.length,
        r: rAt(before),
      };
}

/**
 * How a forecast came out, from its listing's daily bars, oldest first: `null` until its horizon's
 * session has closed, and when the bars start after its anchor, since its sessions cannot then be
 * counted.
 */
export function judgeForecast(
  forecast: Forecast,
  daily: readonly Candle[],
  now: Date
): ForecastOutcome | null {
  const { instrument, anchor, horizon, direction, plan, scenarios } = forecast;
  const dateOf = (bar: Candle) => candleDate(instrument.market, bar.time);

  if (daily.length === 0 || dateOf(daily[0]) > anchor.date) return null;

  const sessions = daily
    .filter((bar) => dateOf(bar) > anchor.date)
    .slice(0, horizon);

  if (sessions.length < horizon) return null;

  const last = sessions[horizon - 1];
  const date = dateOf(last);

  // Today's bar moves until the close.
  if (now.getTime() / 1000 < regularHours(instrument.market, date).close) {
    return null;
  }

  const scenario = scenarios.findIndex((band) => inBand(last.close, band));

  return {
    date,
    close: last.close,
    scenario,
    brier: sumBy(
      scenarios,
      ({ probability }, index) =>
        (probability / 100 - (index === scenario ? 1 : 0)) ** 2
    ),
    plan:
      direction === ForecastDirection.Neutral || !plan
        ? null
        : replayPlan(direction, plan, anchor.price, sessions),
  };
}

/** ISO weekday numbering, Monday 1 to Sunday 7, so Saturday opens the weekend. */
const SATURDAY = 6;

function nextWeekday(date: string): string {
  let next = shiftDate(date, 1);

  while (Temporal.PlainDate.from(next).dayOfWeek >= SATURDAY) {
    next = shiftDate(next, 1);
  }

  return next;
}

/**
 * When each of a forecast's sessions opens, in UTC seconds, the anchor's first, so a path can be
 * drawn over the listing's daily bars, oldest first. A session that has traded takes its bar's
 * day; the rest fall on the weekdays after the last one known, since holidays are not modelled,
 * and move as bars arrive. Empty when the bars start after the anchor, as the sessions cannot
 * then be counted.
 */
export function forecastTimeline(
  { instrument, anchor, horizon }: Forecast,
  daily: readonly Candle[]
): number[] {
  const dateOf = (bar: Candle) => candleDate(instrument.market, bar.time);

  if (daily.length === 0 || dateOf(daily[0]) > anchor.date) return [];

  const dates = [
    anchor.date,
    ...daily
      .map(dateOf)
      .filter((date) => date > anchor.date)
      .slice(0, horizon),
  ];

  while (dates.length <= horizon) {
    dates.push(nextWeekday(dates[dates.length - 1]));
  }

  return dates.map((date) => exchangeMidnight(instrument.market, date));
}

/** Scenarios given a probability within one range, and how many of them came true. */
export interface CalibrationBucket {
  /** Whole percent, from `from` up to `to`; the last bucket also holds 100. */
  from: number;
  to: number;
  scenarios: number;
  held: number;
}

/** How forecasts have come out, which tells how far their probabilities and plans can be trusted. */
export interface ForecastRecord {
  forecasts: number;
  settled: number;
  /** Mean Brier score of the settled; `null` while none is. */
  brier: number | null;
  plans: Record<PlanResult, number>;
  /** Mean R of the plans that entered; `null` while none did. */
  meanR: number | null;
  /** A well-calibrated record holds about as often as each bucket's probabilities say. */
  calibration: CalibrationBucket[];
}

const CALIBRATION_STEP = 20;

export function forecastRecord(forecasts: readonly Forecast[]): ForecastRecord {
  const settled = forecasts.flatMap(({ scenarios, outcome }) =>
    outcome ? [{ scenarios, outcome }] : []
  );

  const plans = settled.flatMap(({ outcome }) =>
    outcome.plan ? [outcome.plan] : []
  );

  const results = countBy(plans, (plan) => plan.result);
  const returns = plans.flatMap((plan) => (plan.r === null ? [] : [plan.r]));

  const stated = settled.flatMap(({ scenarios, outcome }) =>
    scenarios.map(({ probability }, index) => ({
      bucket: Math.min(
        probability - (probability % CALIBRATION_STEP),
        100 - CALIBRATION_STEP
      ),
      held: index === outcome.scenario,
    }))
  );

  return {
    forecasts: forecasts.length,
    settled: settled.length,
    brier:
      settled.length === 0
        ? null
        : meanBy(settled, ({ outcome }) => outcome.brier),
    plans: {
      [PlanResult.NotEntered]: results[PlanResult.NotEntered] ?? 0,
      [PlanResult.HitTarget]: results[PlanResult.HitTarget] ?? 0,
      [PlanResult.HitStop]: results[PlanResult.HitStop] ?? 0,
      [PlanResult.Expired]: results[PlanResult.Expired] ?? 0,
    },
    meanR: returns.length === 0 ? null : meanBy(returns, (r) => r),
    calibration: range(0, 100, CALIBRATION_STEP).map((from) => {
      const scenarios = stated.filter((each) => each.bucket === from);

      return {
        from,
        to: from + CALIBRATION_STEP,
        scenarios: scenarios.length,
        held: scenarios.filter((each) => each.held).length,
      };
    }),
  };
}
