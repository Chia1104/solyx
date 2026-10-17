import { countBy, meanBy, range, sortBy, sumBy } from "es-toolkit";
import * as z from "zod";

import { shiftDate } from "@solyx/utils/date";
import { sentences } from "@solyx/utils/search";

import { candleDate } from "./candles.ts";
import type { Candle } from "./candles.ts";
import type { Council } from "./council.ts";
import type { Dividend } from "./fundamentals.ts";
import { exchangeMidnight, symbolRefSchema } from "./market.ts";
import type { Market } from "./market.ts";
import {
  ReportStance,
  claimSchema,
  proseSchema,
  unsupportedClaims,
} from "./report.ts";
import type { AuditedClaim, Claim, ClaimSupport } from "./report.ts";
import { isOnTick, tickSize } from "./risk.ts";
import { Stance, stanceValue } from "./sentiment.ts";
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
  instrument: symbolRefSchema,
  /** Sessions after the anchor until it settles. */
  horizon: z.number().int().min(1).max(MAX_HORIZON),
  /** Which way its probabilities lean from the listing's history. */
  direction: z.enum(ForecastDirection),
  /** The trade it would take on that lean; `null` where it takes none, as a neutral one never does. */
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
  /** The session's close as it traded. */
  close: number;
  /**
   * Cash a share that went ex after the anchor through the horizon's session, which the close and
   * the plan's bars were judged with added back, since the price falls by it with nothing lost; 0
   * where none did.
   */
  distributed: number;
  /** Index of the scenario whose band held the close. */
  scenario: number;
  /** Squared error of the probabilities against what happened: 0 when sure and right, 2 when sure and wrong. */
  brier: number;
  /** `null` for a forecast without a plan. */
  plan: PlanOutcome | null;
}

/** How one fact bears on its company's share price, as a decisions model read it. */
export interface FactReading {
  /** The model that answered, as its provider names the version. */
  model: string;
  stance: Record<Stance, number>;
}

/**
 * Reads how a fact bears on the share price of the company it is about. It sees the fact and its
 * quote alone, never the forecast they were given for, so what it reads is the evidence and not
 * the forecast's own answer. One implementation per decisions model (`@solyx/decisions/*`); it
 * runs only in the main process.
 */
export interface FactReader {
  read(claim: Claim, options?: { signal?: AbortSignal }): Promise<FactReading>;
}

/**
 * How the facts a forecast rests on bear on the price: the mean of what a decisions model read of
 * each alone. It is a reading of words, not a probability of where the close lands.
 */
export interface EvidenceReading {
  model: string;
  /** How many of the facts were read. */
  facts: number;
  stance: Record<Stance, number>;
}

/** Several facts' readings as one; `null` when none was read. */
export function readEvidence(
  readings: readonly FactReading[]
): EvidenceReading | null {
  if (readings.length === 0) return null;

  const mean = (level: Stance) =>
    meanBy(readings, ({ stance }) => stance[level]);

  return {
    // One decisions model answers at a time, so the newest reading names it.
    model: readings[readings.length - 1].model,
    facts: readings.length,
    stance: {
      [Stance.Negative]: mean(Stance.Negative),
      [Stance.LeanNegative]: mean(Stance.LeanNegative),
      [Stance.Neutral]: mean(Stance.Neutral),
      [Stance.LeanPositive]: mean(Stance.LeanPositive),
      [Stance.Positive]: mean(Stance.Positive),
    },
  };
}

// Half of what somewhat good or bad news reads as, so facts that cancel out call no side. Measured
// per fact with `scripts/eval-facts.ts` in `@solyx/decisions`.
export const EVIDENCE_LEAN_LINE = 0.25;

/** The side of the anchor a reading calls: 1 for a rise, -1 for a fall, and 0 where its facts lean too little to say. */
export function evidenceSide({ stance }: EvidenceReading): number {
  const lean = stanceValue(stance);

  return Math.abs(lean) < EVIDENCE_LEAN_LINE ? 0 : Math.sign(lean);
}

/** A forecast as kept: nothing but its outcome changes once it is made. */
export interface Forecast extends ForecastDraft {
  claims: AuditedClaim[];
  /**
   * How often the listing's own history puts the horizon's close in each scenario's band, as
   * shares in the scenarios' order: what probabilities that knew nothing of the listing but its
   * past moves would be. `null` where its bars held too few such moves.
   */
  baseRates: number[] | null;
  id: string;
  /** Epoch ms. */
  createdAt: number;
  anchor: ForecastAnchor;
  /** The report revision it was made under. */
  reportRevision: number;
  /**
   * How a vote on each scenario came out, in the scenarios' order: each was put as the motion that
   * the close is more likely to land in its band than its base rate says. `null` where none was
   * held, as while the agent decides alone and for a forecast without base rates.
   */
  motions: Council[] | null;
  /** How a decisions model read the facts it rests on; `null` where none read them, or it gave none. */
  evidence: EvidenceReading | null;
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
  /** The base rates of the draft's bands; `null` where the listing's bars hold too few moves. */
  baseRates: number[] | null;
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
  LeanOpposed: "lean-opposed",
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
  | {
      code: typeof ForecastViolationCode.LeanOpposed;
      /** How far the probabilities lean from history, in shares; positive leans up. */
      lean: number;
    }
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

/**
 * Which side of `price` a band lies on: 1 where its every price is at or above it, -1 where its
 * every price is below it, and 0 where it has prices on both sides. A band holds its low and not
 * its high, so one that starts at `price` lies above it.
 */
const bandSide = (
  { low, high }: Pick<ForecastScenario, "low" | "high">,
  price: number
) =>
  Number(low !== null && low >= price) - Number(high !== null && high <= price);

// Shares that cancel leave only what floating point carries.
const NO_LEAN = 1e-9;

/**
 * How far a forecast's probabilities lean from its listing's history, in shares: what they add to
 * the bands whose every price is at or above `price` less what they add to those whose every
 * price is below it, so it is positive where they move weight towards a close at or above
 * `price`. A band with prices on both sides leans neither way. A band holds its low and not its
 * high, so one that starts at `price` lies above it and one that ends there below it: bands
 * split at the last close each take a side, and a modest rise counts as a modest fall does.
 */
export function forecastLean(
  scenarios: readonly Pick<ForecastScenario, "probability" | "low" | "high">[],
  price: number,
  rates: readonly number[]
): number {
  return sumBy(
    scenarios.map(({ probability, ...band }, index) => ({
      added: probability / 100 - rates[index],
      side: bandSide(band, price),
    })),
    ({ added, side }) => added * side
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

  const tiled = tilesEveryPrice(scenarios);

  if (!tiled) {
    violations.push({ code: ForecastViolationCode.BandsBroken });
  }

  // A direction is the way the numbers lean, so one they lean away from says two things at once.
  if (
    direction !== ForecastDirection.Neutral &&
    context.baseRates &&
    sum === 100 &&
    tiled
  ) {
    const lean = forecastLean(
      scenarios,
      context.anchor.price,
      context.baseRates
    );

    if (lean * gainSign(direction) < NO_LEAN) {
      violations.push({ code: ForecastViolationCode.LeanOpposed, lean });
    }
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

  if (!plan) return violations;

  if (direction === ForecastDirection.Neutral) {
    violations.push({ code: ForecastViolationCode.PlanUnexpected });

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
 * counted. The cash of `dividends` that went ex inside the horizon is added back to each bar from
 * its ex-day on, so a price that fell by a dividend is not judged as a fall. Stock distributed and
 * splits are not made up for.
 */
export function judgeForecast(
  forecast: Forecast,
  daily: readonly Candle[],
  now: Date,
  dividends: readonly Dividend[] = []
): ForecastOutcome | null {
  const { instrument, anchor, horizon, direction, plan, scenarios } = forecast;
  const dateOf = (bar: Candle) => candleDate(instrument.market, bar.time);

  if (daily.length === 0 || dateOf(daily[0]) > anchor.date) return null;

  const traded = daily
    .filter((bar) => dateOf(bar) > anchor.date)
    .slice(0, horizon);

  if (traded.length < horizon) return null;

  const date = dateOf(traded[horizon - 1]);

  // Today's bar moves until the close.
  if (now.getTime() / 1000 < regularHours(instrument.market, date).close) {
    return null;
  }

  const sessions = traded.map((bar) => {
    const gone = cashGoneEx(dividends, anchor.date, dateOf(bar));

    return {
      ...bar,
      open: bar.open + gone,
      high: bar.high + gone,
      low: bar.low + gone,
      close: bar.close + gone,
    };
  });

  const last = sessions[horizon - 1];
  const scenario = scenarios.findIndex((band) => inBand(last.close, band));

  return {
    date,
    close: traded[horizon - 1].close,
    distributed: cashGoneEx(dividends, anchor.date, date),
    scenario,
    brier: brierOf(
      scenarios.map(({ probability }) => probability / 100),
      scenario
    ),
    plan:
      direction === ForecastDirection.Neutral || !plan
        ? null
        : replayPlan(direction, plan, anchor.price, sessions),
  };
}

// Fewer moves than a quarter's sessions say too little of how a listing moves.
const BASE_RATE_MOVES = 60;

/** Cash a share that went ex after `after` through `through`, both exchange-local days. */
const cashGoneEx = (
  dividends: readonly Dividend[],
  after: string,
  through: string
) =>
  sumBy(
    dividends.filter(
      ({ cashExDate }) =>
        cashExDate !== null && cashExDate > after && cashExDate <= through
    ),
    ({ cash }) => cash
  );

/**
 * How far a listing's close has moved over `horizon` sessions, each as the later close over the
 * earlier, for every such span its daily bars hold, oldest first. The cash of `dividends` that
 * went ex inside a span counts with its later close, as a forecast is judged. A split, a capital
 * reduction or stock distributed inside the bars reads as a move.
 */
export function horizonMoves(
  market: Market,
  daily: readonly Candle[],
  horizon: number,
  dividends: readonly Dividend[] = []
): number[] {
  const dates = daily.map((bar) => candleDate(market, bar.time));

  return daily
    .slice(horizon)
    .map(
      (bar, index) =>
        (bar.close +
          cashGoneEx(dividends, dates[index], dates[index + horizon])) /
        daily[index].close
    );
}

/**
 * The share of `moves` that, carried from `price`, land in each band, in the bands' order; `null`
 * where there are too few to say.
 */
export function baseRates(
  moves: readonly number[],
  price: number,
  bands: readonly Pick<ForecastScenario, "low" | "high">[]
): number[] | null {
  if (moves.length < BASE_RATE_MOVES) return null;

  return bands.map(
    (band) =>
      moves.filter((move) => inBand(price * move, band)).length / moves.length
  );
}

/** The bands that prices `edges`, ascending, cut every price into: below the first, between each pair, and from the last up. */
export function bandsBetween(
  edges: readonly number[]
): Pick<ForecastScenario, "low" | "high">[] {
  return [null, ...edges].map((low, index) => ({
    low,
    high: edges[index] ?? null,
  }));
}

/** The move below which `share` of `moves` fall. */
export function moveQuantile(moves: readonly number[], share: number): number {
  const sorted = moves.toSorted((a, b) => a - b);
  const place = (sorted.length - 1) * share;
  const below = Math.floor(place);
  const above = Math.min(below + 1, sorted.length - 1);

  return sorted[below] + (sorted[above] - sorted[below]) * (place - below);
}

/** The squared error of `probabilities`, as shares, against the scenario that came true. */
const brierOf = (probabilities: readonly number[], scenario: number) =>
  sumBy(
    probabilities.map((probability, index) => ({ probability, index })),
    ({ probability, index }) =>
      (probability - (index === scenario ? 1 : 0)) ** 2
  );

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
  /** How the settled forecasts that kept base rates did against them; `null` while none has. */
  skill: ForecastSkill | null;
  /**
   * How the scenarios a vote carried as more likely than their history came out, each a call;
   * `null` while no settled forecast was voted on.
   */
  motions: CallRecord | null;
  /**
   * How the side a decisions model read the facts towards came out, each such forecast a call on
   * the bands of that side; `null` while no settled forecast's facts called one.
   */
  evidence: CallRecord | null;
}

/**
 * Calls that the close would land somewhere, against how often history alone has it land there: a
 * caller that tells nothing has it land in about as many as expected.
 */
export interface CallRecord {
  calls: number;
  /** Those the close landed in. */
  held: number;
  /** How many history alone would have it land in: the sum of their base rates. */
  expected: number;
}

/** Forecasts against the base rates of their own bands, which a forecast that knew only the listing's past moves would have given. */
export interface ForecastSkill {
  forecasts: number;
  /** Their mean Brier score, and the base rates' own over the same forecasts. */
  brier: number;
  baseBrier: number;
  /**
   * The share of the base rates' error the forecasts took away: 0 is no better than history
   * alone, below it worse, and 1 sure and right. `null` where the base rates left no error.
   */
  skill: number | null;
}

function forecastSkill(forecasts: readonly Forecast[]): ForecastSkill | null {
  const based = forecasts.flatMap(({ baseRates: rates, outcome }) =>
    rates && outcome
      ? [{ brier: outcome.brier, baseBrier: brierOf(rates, outcome.scenario) }]
      : []
  );

  if (based.length === 0) return null;

  const brier = meanBy(based, (each) => each.brier);
  const baseBrier = meanBy(based, (each) => each.baseBrier);

  return {
    forecasts: based.length,
    brier,
    baseBrier,
    skill: baseBrier === 0 ? null : 1 - brier / baseBrier,
  };
}

function callRecord(
  calls: readonly { rate: number; held: boolean }[]
): CallRecord {
  return {
    calls: calls.length,
    held: calls.filter(({ held }) => held).length,
    expected: sumBy(calls, ({ rate }) => rate),
  };
}

function motionRecord(forecasts: readonly Forecast[]): CallRecord | null {
  const voted = forecasts.flatMap(({ motions, baseRates: rates, outcome }) =>
    motions && rates && outcome ? [{ motions, rates, outcome }] : []
  );

  if (voted.length === 0) return null;

  return callRecord(
    voted.flatMap(({ motions, rates, outcome }) =>
      motions.flatMap(({ carried }, scenario) =>
        carried
          ? [{ rate: rates[scenario], held: scenario === outcome.scenario }]
          : []
      )
    )
  );
}

function evidenceRecord(forecasts: readonly Forecast[]): CallRecord | null {
  const called = forecasts.flatMap(
    ({ evidence, baseRates: rates, scenarios, anchor, outcome }) => {
      if (!evidence || !rates || !outcome) return [];

      const side = evidenceSide(evidence);
      const sides = scenarios.map((band) => bandSide(band, anchor.price));

      // A forecast with no band on the side its facts read towards has nowhere for the call to land.
      if (side === 0 || !sides.includes(side)) return [];

      return [
        {
          rate: sumBy(rates, (rate, index) =>
            sides[index] === side ? rate : 0
          ),
          held: sides[outcome.scenario] === side,
        },
      ];
    }
  );

  return called.length === 0 ? null : callRecord(called);
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
    skill: forecastSkill(forecasts),
    motions: motionRecord(forecasts),
    evidence: evidenceRecord(forecasts),
  };
}

/** The parts of a forecast a search reads one by one: each sentence of its rationale, its contrary case and its claims. */
export function forecastPassages(forecast: ForecastDraft): string[] {
  return [
    ...sentences(forecast.rationale),
    ...(forecast.contrary ? [`contrary: ${forecast.contrary}`] : []),
    ...forecast.claims.map((claim) => `claim: ${claim.text}`),
  ];
}
