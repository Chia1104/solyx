import type { EventTiming } from "./calendar.ts";
import type { Market } from "./market.ts";

/** A figure on an economy that its agencies release on a schedule. */
export const MacroIndicator = {
  /** A month's consumer prices. */
  ConsumerPrices: "consumer-prices",
  /** The first estimate of a quarter's output. */
  AdvanceGdp: "advance-gdp",
  /** Past quarters' output as revised. */
  Gdp: "gdp",
  /** The official forecast of growth and prices. */
  EconomicForecast: "economic-forecast",
  /** A month's unemployment rate. */
  Unemployment: "unemployment",
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
} as const;

export type MacroIndicator =
  (typeof MacroIndicator)[keyof typeof MacroIndicator];

export interface MacroRelease {
  /** The market whose economy the figure describes. */
  market: Market;
  indicator: MacroIndicator;
  /** `YYYY-MM-DD` on the market's exchange calendar. */
  date: string;
  timing: EventTiming;
  /** The period it covers, the latest where it covers several: a month `YYYY-MM`, a quarter `YYYY-Qn` or a year `YYYY`. */
  period: string | null;
}

/** Where a market's schedule of economic releases comes from. */
export interface MacroCalendarProvider {
  readonly id: string;
  readonly markets: readonly Market[];
  /** The releases scheduled for the market from `since`, an exchange-local day, on, soonest first. */
  releases(market: Market, since: string): Promise<MacroRelease[]>;
}
