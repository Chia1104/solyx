import type {
  Forecast,
  ForecastOutcome,
  ForecastScenario,
} from "@solyx/core/forecast";

/** Which side of a range a price stands on. */
export const RangeSide = {
  Below: "below",
  Within: "within",
  Above: "above",
} as const;

export type RangeSide = (typeof RangeSide)[keyof typeof RangeSide];

/** Where a price stands against a range, along a scale that holds both. */
export interface RangePlace {
  /** The range's ends and the price along the scale, each from 0 to 1. */
  from: number;
  to: number;
  at: number;
  side: RangeSide;
  /** How far the price is from each end, as a share of that end: above it when positive. */
  fromLow: number;
  fromHigh: number;
}

// Kept clear at each end of the scale, so a mark at an end is not drawn on the track's edge.
const MARGIN = 0.1;

export function rangePlace(
  low: number,
  high: number,
  price: number
): RangePlace {
  const start = Math.min(low, price);
  const span = Math.max(high, price) - start;

  // A range with no width that the price sits on has no scale to place anything on.
  const along = (value: number) =>
    span === 0 ? 0.5 : MARGIN + ((value - start) / span) * (1 - 2 * MARGIN);

  let side: RangeSide = RangeSide.Within;

  if (price < low) side = RangeSide.Below;
  else if (price > high) side = RangeSide.Above;

  return {
    from: along(low),
    to: along(high),
    at: along(price),
    side,
    fromLow: price / low - 1,
    fromHigh: price / high - 1,
  };
}

/** One forecast on the record's strip. */
export interface ForecastMark {
  id: string;
  /** The exchange-local day it was anchored on. */
  date: string;
  /** How it came out; `null` while its horizon is open. */
  settled: {
    /** What it gave the band that held, as a share. */
    given: number;
    /** What the listing's history gave that band; `null` where the forecast kept no base rates. */
    history: number | null;
    /** Whether no other band was given more. */
    led: boolean;
  } | null;
}

/** What a mark reads of a forecast. */
type Recorded = Pick<Forecast, "id" | "anchor" | "baseRates"> & {
  scenarios: readonly Pick<ForecastScenario, "probability">[];
  outcome: Pick<ForecastOutcome, "scenario"> | null;
};

/** The newest forecasts as marks, oldest first, at most `limit` of them. */
export function forecastMarks(
  forecasts: readonly Recorded[],
  limit: number
): ForecastMark[] {
  return forecasts
    .slice(-limit)
    .map(({ id, anchor, scenarios, baseRates, outcome }) => {
      const held = outcome ? scenarios[outcome.scenario] : undefined;

      return {
        id,
        date: anchor.date,
        settled:
          outcome && held
            ? {
                given: held.probability / 100,
                history: baseRates?.[outcome.scenario] ?? null,
                led: scenarios.every(
                  ({ probability }) => probability <= held.probability
                ),
              }
            : null,
      };
    });
}
