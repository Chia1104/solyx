import * as z from "zod";

import { Interval, isIntraday } from "@solyx/core/candles";
import { Market } from "@solyx/core/market";

export const ChartIndicator = {
  MovingAverage: "ma",
  LongMovingAverage: "ma-long",
  Bollinger: "boll",
  Vwap: "vwap",
  Macd: "macd",
  Rsi: "rsi",
  Kd: "kd",
  VolumeRatio: "vol-ratio",
  RelativeStrength: "rs",
  YearRange: "year-range",
  Zones: "zones",
  VolumeProfile: "volume-profile",
  SessionLevels: "session-levels",
  ForeignFlow: "foreign-flow",
  TrustFlow: "trust-flow",
  Margin: "margin",
} as const;

export type ChartIndicator =
  (typeof ChartIndicator)[keyof typeof ChartIndicator];

export const chartIndicatorSchema = z.enum(ChartIndicator);

/** Drawn from who traded a listing, which only Taiwan's exchanges report. */
export const FLOW_INDICATORS: readonly ChartIndicator[] = [
  ChartIndicator.ForeignFlow,
  ChartIndicator.TrustFlow,
  ChartIndicator.Margin,
];

/** Drawn from sessions, which only daily bars count one by one. */
export const DAILY_INDICATORS: readonly ChartIndicator[] = [
  ChartIndicator.RelativeStrength,
  ChartIndicator.YearRange,
  ChartIndicator.Zones,
  ChartIndicator.VolumeProfile,
];

/** Drawn session by session, which needs bars shorter than one. */
export const INTRADAY_INDICATORS: readonly ChartIndicator[] = [
  ChartIndicator.Vwap,
  ChartIndicator.SessionLevels,
];

/** The indicators a chart of `market` on bars of `interval` can draw. */
export function offeredIndicators(
  market: Market,
  interval: Interval
): ChartIndicator[] {
  return Object.values(ChartIndicator).filter(
    (indicator) =>
      (market === Market.TW || !FLOW_INDICATORS.includes(indicator)) &&
      (interval === Interval.OneDay || !DAILY_INDICATORS.includes(indicator)) &&
      (isIntraday(interval) || !INTRADAY_INDICATORS.includes(indicator))
  );
}
