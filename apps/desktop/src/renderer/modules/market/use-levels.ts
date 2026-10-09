import { useMemo } from "react";

import { LineStyle } from "lightweight-charts";
import type {
  CreatePriceLineOptions,
  SeriesMarker,
  UTCTimestamp,
} from "lightweight-charts";
import { useTranslation } from "react-i18next";

import type { Candle } from "@solyx/core/candles";
import { MOVING_AVERAGE_PERIODS, sma } from "@solyx/core/indicators";
import {
  ZoneKind,
  breaksBelow,
  pointOfControl,
  supportZones,
  volumeProfile,
  yearRange,
} from "@solyx/core/levels";
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
 * What a daily chart marks on its bars as the user switched it on: closes breaking below the
 * quarter and year lines, which come with the long moving averages, the 52-week range, the
 * support zones and the volume profile. Every part is `undefined` while it is off.
 */
export function useLevels({
  candles,
  times,
  closes,
  daily,
}: {
  candles: Candle[];
  times: UTCTimestamp[];
  closes: number[];
  daily: boolean;
}) {
  const { t, i18n } = useTranslation();
  const colors = usePaletteColors();
  const enabled = useIndicatorStore((state) => state.enabled);

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

  // Read apart from the price lines, which then change only when the range does.
  const range = useMemo(
    () => (showRange ? yearRange(candles) : null),
    [showRange, candles]
  );

  const high = range?.high;
  const low = range?.low;

  const priceLines = useMemo(() => {
    if (high === undefined || low === undefined) return undefined;

    const line = (price: number, title: string): CreatePriceLineOptions => ({
      price,
      title,
      color: LINE_COLORS.level,
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: true,
    });

    return [
      line(high, t("chart.levels.year-high")),
      line(low, t("chart.levels.year-low")),
    ];
  }, [high, low, t]);

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
