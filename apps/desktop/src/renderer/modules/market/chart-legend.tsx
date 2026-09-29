import { useEffect, useMemo, useState } from "react";

import { memoize } from "es-toolkit";
import { isUTCTimestamp } from "lightweight-charts";
import type { MouseEventParams } from "lightweight-charts";
import { useTranslation } from "react-i18next";

import type { Candle } from "@solyx/core/candles";
import { useChart } from "@solyx/trading-chart/chart";

export interface LegendLine {
  label: string;
  color: string;
  values: (number | null)[];
}

// The legend renders on every crosshair move, so formatters are built once per locale.
const legendFormats = memoize((locale: string) => ({
  price: new Intl.NumberFormat(locale, { maximumFractionDigits: 4 }),
  indicator: new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }),
  volume: new Intl.NumberFormat(locale, {
    notation: "compact",
    maximumFractionDigits: 2,
  }),
  change: new Intl.NumberFormat(locale, {
    style: "percent",
    signDisplay: "exceptZero",
    maximumFractionDigits: 2,
  }),
}));

/** OHLCV and overlay values for the bar under the crosshair, or the latest bar. */
export function ChartLegend({
  candles,
  lines,
}: {
  candles: Candle[];
  lines: LegendLine[];
}) {
  const { t, i18n } = useTranslation();
  const chart = useChart();
  const [hoveredTime, setHoveredTime] = useState<number | null>(null);

  useEffect(() => {
    const onMove = ({ time }: MouseEventParams) =>
      setHoveredTime(time !== undefined && isUTCTimestamp(time) ? time : null);

    chart.subscribeCrosshairMove(onMove);

    return () => chart.unsubscribeCrosshairMove(onMove);
  }, [chart]);

  const indexByTime = useMemo(
    () => new Map(candles.map((candle, index) => [candle.time, index])),
    [candles]
  );

  const index =
    (hoveredTime === null ? undefined : indexByTime.get(hoveredTime)) ??
    candles.length - 1;

  const candle = candles[index];
  const previousClose = candles[index - 1]?.close;

  const format = legendFormats(i18n.language);

  const change =
    previousClose === undefined
      ? null
      : format.change.format((candle.close - previousClose) / previousClose);

  return (
    <div className="pointer-events-none absolute top-1 left-2 z-10 flex flex-col gap-0.5 text-xs tabular-nums">
      <div className="flex gap-3">
        <span>
          {t("chart.legend.open")} {format.price.format(candle.open)}
        </span>
        <span>
          {t("chart.legend.high")} {format.price.format(candle.high)}
        </span>
        <span>
          {t("chart.legend.low")} {format.price.format(candle.low)}
        </span>
        <span>
          {t("chart.legend.close")} {format.price.format(candle.close)}
          {change && ` (${change})`}
        </span>
        <span>
          {t("chart.legend.volume")} {format.volume.format(candle.volume)}
        </span>
      </div>
      {lines.length > 0 && (
        <div className="flex gap-3">
          {lines.map((line) => {
            const value = line.values[index];

            return (
              <span key={line.label} style={{ color: line.color }}>
                {line.label}{" "}
                {value === null ? "—" : format.indicator.format(value)}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
