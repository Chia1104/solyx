/** A maturity of US Treasury debt that the curve is read at. */
export const TreasuryTenor = {
  ThreeMonths: "3m",
  TwoYears: "2y",
  TenYears: "10y",
  ThirtyYears: "30y",
} as const;

export type TreasuryTenor = (typeof TreasuryTenor)[keyof typeof TreasuryTenor];

/** US Treasury debt's par yields at one day's close, in percent; `null` at a tenor the day has none. */
export interface YieldCurve {
  /** `YYYY-MM-DD` on New York's calendar. */
  date: string;
  yields: Record<TreasuryTenor, number | null>;
}

/** How far ten years' yield stands above two years', in percentage points; `null` where either is missing, and below zero while the curve is inverted. */
export function curveSpread({ yields }: YieldCurve): number | null {
  const long = yields[TreasuryTenor.TenYears];
  const short = yields[TreasuryTenor.TwoYears];

  return long === null || short === null ? null : long - short;
}

/** Where the US Treasury's daily par yield curve comes from. */
export interface YieldCurveProvider {
  readonly id: string;
  /** Every day's curve from `since`, a day, on, oldest first. */
  curves(since: string): Promise<YieldCurve[]>;
}
