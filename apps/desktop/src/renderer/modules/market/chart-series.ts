import { LineStyle } from "lightweight-charts";
import type {
  CreatePriceLineOptions,
  HistogramData,
  LineData,
  LineSeriesPartialOptions,
  UTCTimestamp,
  WhitespaceData,
} from "lightweight-charts";

import type { IndicatorLine } from "@solyx/core/indicators";

import { LINE_COLORS } from "./chart-palette.ts";

export const PRICE_PANE_STRETCH = 3;

export const LOWER_PANE_STRETCH = 1;

/** Thin lines without price labels, so overlays do not crowd the price scale. */
export function lineOptions(color: string): LineSeriesPartialOptions {
  return {
    color,
    lineWidth: 1,
    priceLineVisible: false,
    lastValueVisible: false,
    crosshairMarkerVisible: false,
  };
}

/** A dashed reference level, such as RSI's 70. */
export function level(price: number): CreatePriceLineOptions {
  return {
    price,
    color: LINE_COLORS.level,
    lineWidth: 1,
    lineStyle: LineStyle.Dashed,
    axisLabelVisible: false,
  };
}

/** Warm-up values become whitespace, so every line keeps the candles' time axis. */
export function toLine(
  times: UTCTimestamp[],
  line: IndicatorLine
): (LineData | WhitespaceData)[] {
  return times.map((time, i) => {
    const value = line[i];

    return value === null ? { time } : { time, value };
  });
}

export function toHistogram(
  times: UTCTimestamp[],
  line: IndicatorLine,
  rise: string,
  fall: string
): (HistogramData | WhitespaceData)[] {
  return times.map((time, i) => {
    const value = line[i];

    return value === null
      ? { time }
      : { time, value, color: value >= 0 ? rise : fall };
  });
}
