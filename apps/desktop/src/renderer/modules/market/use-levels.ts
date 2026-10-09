import { useMemo } from "react";

import { LineStyle } from "lightweight-charts";
import type {
  CreatePriceLineOptions,
  SeriesMarker,
  UTCTimestamp,
} from "lightweight-charts";
import { useTranslation } from "react-i18next";

import { Interval, isIntraday } from "@solyx/core/candles";
import type { Candle } from "@solyx/core/candles";
import { MOVING_AVERAGE_PERIODS, sma } from "@solyx/core/indicators";
import {
  ZoneKind,
  breaksBelow,
  openingRange,
  pointOfControl,
  previousSession,
  supportZones,
  volumeProfile,
  yearRange,
} from "@solyx/core/levels";
import type { Market } from "@solyx/core/market";
import type { PriceBand } from "@solyx/trading-chart/price-bands";

import { usePaletteColors } from "../../app/theme.ts";

import { LINE_COLORS, MOVING_AVERAGE_COLORS, faded } from "./chart-palette.ts";
import { ChartIndicator, useIndicatorStore } from "./indicator-store.ts";
import { numberFormats } from "./number-formats.ts";

const [QUARTER_LINE, , YEAR_LINE] = MOVING_AVERAGE_PERIODS.long;

const [QUARTER_COLOR, HALF_YEAR_COLOR, YEAR_COLOR] = MOVING_AVERAGE_COLORS.long;

// A zone takes the colour of the line it rings; the densest trading takes the profile's.
const ZONE_COLORS: Record<ZoneKind, string> = {
  [ZoneKind.QuarterLine]: QUARTER_COLOR,
  [ZoneKind.HalfYearLine]: HALF_YEAR_COLOR,
  [ZoneKind.Volume]: LINE_COLORS.control,
};

const ZONE_OPACITY = 0.12;

// The busiest slice of the profile reaches this share of the pane in from its right edge.
const PROFILE_WIDTH = 0.2;

/**
 * What a chart marks on its bars as the user switched it on. Daily bars mark closes breaking
 * below the quarter and year lines, which come with the long moving averages, the 52-week
 * range, the support zones and the volume profile; intraday bars mark the session before's
 * high, low and close and the opening range. Every part is `undefined` while it is off.
 */
export function useLevels({
  candles,
  times,
  closes,
  market,
  interval,
}: {
  candles: Candle[];
  times: UTCTimestamp[];
  closes: number[];
  market: Market;
  interval: Interval;
}) {
  const { t, i18n } = useTranslation();
  const colors = usePaletteColors();
  const enabled = useIndicatorStore((state) => state.enabled);
  const daily = interval === Interval.OneDay;

  const shown = (indicator: ChartIndicator) =>
    daily && enabled.includes(indicator);

  const showBreaks = shown(ChartIndicator.LongMovingAverage);
  const showRange = shown(ChartIndicator.YearRange);
  const showZones = shown(ChartIndicator.Zones);
  const showProfile = shown(ChartIndicator.VolumeProfile);

  const markers = useMemo(() => {
    if (!showBreaks) return undefined;

    const breaks = (period: number, color: string, text: string) =>
      breaksBelow(closes, sma(closes, period)).map(
        (index): SeriesMarker<UTCTimestamp> => ({
          time: times[index],
          position: "aboveBar",
          // Lightweight Charts' own field; a computed key keeps it apart from the names we choose.
          ["shape"]: "arrowDown",
          color,
          text,
        })
      );

    return [
      ...breaks(
        QUARTER_LINE,
        QUARTER_COLOR,
        t("chart.levels.quarter-line-break")
      ),
      ...breaks(YEAR_LINE, YEAR_COLOR, t("chart.levels.year-line-break")),
    ].toSorted((a, b) => a.time - b.time);
  }, [showBreaks, closes, times, t]);

  const sessionInterval =
    isIntraday(interval) && enabled.includes(ChartIndicator.SessionLevels)
      ? interval
      : null;

  // Read apart from the price lines, which then change only when a price does.
  const prices = useMemo(
    () => ({
      year: showRange ? yearRange(candles) : null,
      previous: sessionInterval ? previousSession(market, candles) : null,
      opening: sessionInterval
        ? openingRange(market, sessionInterval, candles)
        : null,
    }),
    [showRange, sessionInterval, market, candles]
  );

  const yearHigh = prices.year?.high;
  const yearLow = prices.year?.low;
  const previousHigh = prices.previous?.high;
  const previousClose = prices.previous?.close;
  const previousLow = prices.previous?.low;
  const openingHigh = prices.opening?.high;
  const openingLow = prices.opening?.low;

  const priceLines = useMemo(() => {
    const lines: CreatePriceLineOptions[] = [];

    const add = (
      price: number | undefined,
      title: string,
      lineStyle: LineStyle
    ) => {
      if (price === undefined) return;

      lines.push({
        price,
        title,
        color: LINE_COLORS.level,
        lineWidth: 1,
        lineStyle,
        axisLabelVisible: true,
      });
    };

    add(yearHigh, t("chart.levels.year-high"), LineStyle.Dashed);
    add(yearLow, t("chart.levels.year-low"), LineStyle.Dashed);
    add(previousHigh, t("chart.levels.previous-high"), LineStyle.Dotted);
    add(previousClose, t("chart.levels.previous-close"), LineStyle.Dotted);
    add(previousLow, t("chart.levels.previous-low"), LineStyle.Dotted);
    add(openingHigh, t("chart.levels.opening-high"), LineStyle.LargeDashed);
    add(openingLow, t("chart.levels.opening-low"), LineStyle.LargeDashed);

    return lines.length === 0 ? undefined : lines;
  }, [
    yearHigh,
    yearLow,
    previousHigh,
    previousClose,
    previousLow,
    openingHigh,
    openingLow,
    t,
  ]);

  const bands = useMemo(() => {
    if (!showZones && !showProfile) return undefined;

    const format = numberFormats(i18n.language).indicator;
    const profile = showProfile ? volumeProfile(candles) : [];
    const control = pointOfControl(profile);
    const busiest = control?.volume ?? 0;

    const slices = profile
      .filter((slice) => slice.volume > 0)
      .map((slice): PriceBand => ({
        low: slice.low,
        high: slice.high,
        width: (PROFILE_WIDTH * slice.volume) / busiest,
        ...(slice === control
          ? {
              color: faded(LINE_COLORS.control, 0.5),
              label: t("chart.levels.control"),
            }
          : { color: faded(colors.muted, 0.25) }),
      }));

    const zones = (showZones ? supportZones(candles) : []).map(
      (zone): PriceBand => ({
        low: zone.low,
        high: zone.high,
        color: faded(ZONE_COLORS[zone.kind], ZONE_OPACITY),
        label: t(`chart.levels.zones.${zone.kind}`, {
          low: format.format(zone.low),
          high: format.format(zone.high),
        }),
        labelColor: ZONE_COLORS[zone.kind],
      })
    );

    return [...slices, ...zones];
  }, [showZones, showProfile, candles, colors.muted, i18n.language, t]);

  return { markers, priceLines, bands };
}
