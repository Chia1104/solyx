import type { EventTiming } from "./calendar.ts";
import type { Market } from "./market.ts";

/** A figure on an economy that its agencies release on a schedule. */
export const MacroIndicator = {
  /** A month's consumer prices. */
  ConsumerPrices: "consumer-prices",
  /** The first estimate of a quarter's output. */
  AdvanceGdp: "advance-gdp",
  /** The official forecast of growth and prices. */
  EconomicForecast: "economic-forecast",
  /** A month's exports and imports through customs. */
  Trade: "trade",
  /** A month's export orders taken. */
  ExportOrders: "export-orders",
  /** A month's industrial production. */
  IndustrialProduction: "industrial-production",
  /** Taiwan's monitoring indicator, the five-colour business signal. */
  BusinessSignal: "business-signal",
  /** A month's purchasing managers' indices of manufacturing and services. */
  PurchasingManagers: "purchasing-managers",
  /** A month's survey of manufacturing's purchasing managers alone. */
  ManufacturingSurvey: "manufacturing-survey",
  /** A month's survey of the purchasing managers of services alone. */
  ServicesSurvey: "services-survey",
  /** A central bank's decision on its policy rate. */
  PolicyRate: "policy-rate",
  /** A month's report on jobs and pay. */
  Employment: "employment",
  /** A month's personal income and spending, with the prices of what households bought. */
  PersonalIncome: "personal-income",
  /** A month's retail sales. */
  RetailSales: "retail-sales",
  /** A month's producer prices. */
  ProducerPrices: "producer-prices",
  /** A week's new claims for unemployment benefits. */
  JoblessClaims: "jobless-claims",
  /** A month's survey of how consumers feel about their finances and the economy. */
  ConsumerSentiment: "consumer-sentiment",
} as const;

export type MacroIndicator =
  (typeof MacroIndicator)[keyof typeof MacroIndicator];

export interface MacroRelease {
  /** The market whose economy the figure describes. */
  market: Market;
  indicator: MacroIndicator;
  /** `YYYY-MM-DD` on the market's exchange calendar. */
  date: string;
  /** The time of day it comes out, `HH:mm` on the exchange's clock; `null` where the schedule gives none. */
  time: string | null;
  timing: EventTiming;
  /** The period it covers, the latest where it covers several: a month `YYYY-MM`, a quarter `YYYY-Qn`, a year `YYYY`, or a day `YYYY-MM-DD`, a decision's or a week's last. */
  period: string | null;
  /** The agency's page the release comes out on, an https address; `null` where the schedule links none. */
  page: string | null;
}

/** A figure an indicator's release brings. */
export const MacroFigure = {
  /** The consumer price index, whose growth on the year is inflation. */
  ConsumerPrices: "consumer-prices",
  /** Consumer prices without vegetables, fruit and energy. */
  CoreConsumerPrices: "core-consumer-prices",
  Exports: "exports",
  Imports: "imports",
  ExportOrders: "export-orders",
  /** The index of industrial production. */
  IndustrialProduction: "industrial-production",
  /** The monitoring indicator's score, which sets the colour of the business signal. */
  BusinessSignal: "business-signal",
  /** Real output's growth on the year. */
  GdpGrowth: "gdp-growth",
  /** Real output's growth on the quarter before, at an annual rate. */
  GdpAnnualized: "gdp-annualized",
  /** The rate a central bank set, the middle of its range where it sets one. */
  PolicyRate: "policy-rate",
  /** Jobs added outside farms over the month. */
  PayrollsAdded: "payrolls-added",
  Unemployment: "unemployment",
  HourlyEarnings: "hourly-earnings",
  /** The prices of what households bought. */
  PcePrices: "pce-prices",
  /** Those prices without food and energy. */
  CorePcePrices: "core-pce-prices",
  /** Retail sales' change from the month before. */
  RetailSales: "retail-sales",
  ProducerPrices: "producer-prices",
  ManufacturingPmi: "manufacturing-pmi",
  ServicesPmi: "services-pmi",
  InitialClaims: "initial-claims",
  ConsumerSentiment: "consumer-sentiment",
} as const;

export type MacroFigure = (typeof MacroFigure)[keyof typeof MacroFigure];

/** What a figure counts in, which says how it is read. */
export const MacroUnit = {
  /** An index against a base period: its level says little, and its growth on the year is what is read. */
  Index: "index",
  /** Millions of US dollars. */
  UsdMillions: "usd-millions",
  /** Points of a score. */
  Points: "points",
  /** Percent, as a rate of growth already is. */
  Percent: "percent",
  /** Percent that is a level rather than a change, as unemployment's and a policy rate are. */
  Rate: "rate",
  /** Percent growth on the same period a year before, as a source that reports no level gives it. */
  GrowthOnYear: "growth-on-year",
  /** Thousands, of people or of claims. */
  Thousands: "thousands",
} as const;

export type MacroUnit = (typeof MacroUnit)[keyof typeof MacroUnit];

export interface MacroObservation {
  /** A month `YYYY-MM`, a quarter `YYYY-Qn`, or a day `YYYY-MM-DD`, a decision's or a week's last. */
  period: string;
  value: number;
  /** What the market expected it to come out at; `null` where the source gives none. */
  forecast: number | null;
}

/** A period not out yet, with what the market expects it to come out at. */
export interface MacroExpectation {
  period: string;
  forecast: number;
}

/** One figure of an indicator, period by period, as its agency's database holds it. */
export interface MacroSeries {
  market: Market;
  indicator: MacroIndicator;
  figure: MacroFigure;
  unit: MacroUnit;
  /** Oldest first, every period from the first asked for through the newest already out. */
  observations: MacroObservation[];
  /** The next period, while the market's expectation of it is known; `null` otherwise. */
  expected: MacroExpectation | null;
}

/** A figure at one period against the periods before it. */
export interface MacroReading {
  figure: MacroFigure;
  unit: MacroUnit;
  period: string;
  value: number;
  /** The period before's; `null` where the series does not reach it. */
  previous: number | null;
  /** What the market expected; `null` where the source gives none. */
  forecast: number | null;
  /**
   * Its growth on the same period a year before, as a share; `null` for a rate or a score, which
   * growth says nothing of, and where the series does not reach a year back.
   */
  yoy: number | null;
}

const GROWS: readonly MacroUnit[] = [MacroUnit.Index, MacroUnit.UsdMillions];

/** The same month or quarter a year before. */
const yearBefore = (period: string) =>
  `${Number(period.slice(0, 4)) - 1}${period.slice(4)}`;

/** Each period of a series against the one before it and the one a year before, oldest first as given. */
export function macroReadings({
  figure,
  unit,
  observations,
}: MacroSeries): MacroReading[] {
  const byPeriod = new Map(
    observations.map(({ period, value }) => [period, value])
  );

  return observations.map(({ period, value, forecast }, index) => {
    const yearAgo = byPeriod.get(yearBefore(period));

    return {
      figure,
      unit,
      period,
      value,
      previous: observations[index - 1]?.value ?? null,
      forecast,
      yoy:
        unit === MacroUnit.GrowthOnYear
          ? value / 100
          : GROWS.includes(unit) && yearAgo !== undefined && yearAgo > 0
            ? value / yearAgo - 1
            : null,
    };
  });
}

/**
 * What is known of a release's figures: each of its indicator's at the release's period once that
 * is out, or else at the newest period out before it, so a reading's own period tells which.
 */
export function releaseReadings(
  {
    market,
    indicator,
    period,
  }: Pick<MacroRelease, "market" | "indicator" | "period">,
  series: readonly MacroSeries[]
): MacroReading[] {
  return series
    .filter((each) => each.market === market && each.indicator === indicator)
    .flatMap((each) => {
      const reading = macroReadings(each).findLast(
        (candidate) => period === null || candidate.period <= period
      );

      return reading ? [reading] : [];
    });
}

/** A release's figure whose period is not out yet, with what the market expects of it. */
export interface ExpectedFigure extends MacroExpectation {
  figure: MacroFigure;
  unit: MacroUnit;
}

/** What the market expects of a release's figures where its own period is not out yet, an indicator's headline first. */
export function releaseExpectations(
  {
    market,
    indicator,
    period,
  }: Pick<MacroRelease, "market" | "indicator" | "period">,
  series: readonly MacroSeries[]
): ExpectedFigure[] {
  return series.flatMap((each) =>
    each.market === market &&
    each.indicator === indicator &&
    each.expected?.period === period
      ? [{ figure: each.figure, unit: each.unit, ...each.expected }]
      : []
  );
}

/** Where a market's schedule of economic releases comes from. */
export interface MacroCalendarProvider {
  readonly id: string;
  readonly markets: readonly Market[];
  /** The releases scheduled for the market from `since`, an exchange-local day, on, soonest first. */
  releases(market: Market, since: string): Promise<MacroRelease[]>;
}

/** Where the figures of a market's indicators come from, as its statistics agency's database serves them. */
export interface MacroFiguresProvider {
  readonly id: string;
  readonly markets: readonly Market[];
  /** Every figure it follows from `since` (`YYYY-MM`) on, an indicator's headline figure first; none for a market it does not cover. */
  series(market: Market, since: string): Promise<MacroSeries[]>;
}
