import { useEffect, useMemo, useState } from "react";

import {
  ColorType,
  CrosshairMode,
  LineSeries,
  LineStyle,
} from "lightweight-charts";
import type {
  ChartOptions,
  DeepPartial,
  IChartApi,
  LineSeriesPartialOptions,
  SeriesMarker,
  Time,
} from "lightweight-charts";
import { useTranslation } from "react-i18next";

import { Chart } from "@solyx/trading-chart/chart";
import { Series } from "@solyx/trading-chart/series";

import { usePaletteColors } from "../../app/theme.ts";
import { LINE_COLORS } from "../market/chart-palette.ts";
import { numberFormats } from "../market/number-formats.ts";

/** A value at each session's close, as a run's equity and holding are kept. */
interface SessionValue {
  date: string;
  value: number;
}

/** One line of returns: values at each session's close against the capital they started from. */
export interface ReturnLine {
  id: string;
  label: string;
  color: string;
  dashed?: boolean;
  capital: number;
  values: SessionValue[];
}

// Returns are drawn to a hundredth of a percent.
const RETURN_MOVE = 0.0001;

function ReturnSeries({
  line,
  markers,
}: {
  line: ReturnLine;
  markers?: SeriesMarker<Time>[];
}) {
  const { i18n } = useTranslation();
  const format = numberFormats(i18n.language);

  const options = useMemo<LineSeriesPartialOptions>(
    () => ({
      color: line.color,
      lineWidth: line.dashed ? 1 : 2,
      lineStyle: line.dashed ? LineStyle.Dashed : LineStyle.Solid,
      priceLineVisible: !line.dashed,
      priceFormat: {
        type: "custom",
        minMove: RETURN_MOVE,
        formatter: (value: number) => format.percentChange.format(value),
      },
    }),
    [line.color, line.dashed, format]
  );

  const data = useMemo(
    () =>
      line.values.map(({ date, value }) => ({
        time: date,
        value: value / line.capital - 1,
      })),
    [line.values, line.capital]
  );

  return (
    <Series
      definition={LineSeries}
      data={data}
      options={options}
      markers={markers}
    />
  );
}

/**
 * Lines of returns on their capital at each session's close, the whole of each in view, with the
 * out-of-sample stretch marked on the last line where it starts.
 */
export function ReturnChart({
  title,
  lines,
  split,
}: {
  title: string;
  lines: ReturnLine[];
  /** The first session out of sample, where there is a split. */
  split: string | null;
}) {
  const { t, i18n } = useTranslation();
  const colors = usePaletteColors();
  const [chart, setChart] = useState<IChartApi | null>(null);

  const options = useMemo<DeepPartial<ChartOptions>>(
    () => ({
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: colors.muted,
      },
      grid: {
        vertLines: { color: colors.separator },
        horzLines: { color: colors.separator },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderVisible: false },
      // Ten years of sessions fit a narrow pane only below the default spacing.
      timeScale: { borderVisible: false, minBarSpacing: 0.05 },
      localization: { locale: i18n.language },
    }),
    [colors, i18n.language]
  );

  const markers = useMemo<SeriesMarker<Time>[] | undefined>(
    () =>
      split === null
        ? undefined
        : [
            {
              time: split,
              position: "aboveBar",
              // Lightweight Charts' own field; a computed key keeps it apart from the names we choose.
              ["shape"]: "arrowDown",
              color: colors.muted,
              text: t("backtests.report.out-of-sample"),
            },
          ],
    [split, colors, t]
  );

  // The whole run is in view, so the stretches read side by side; the series set their data first.
  useEffect(() => {
    chart?.timeScale().fitContent();
  }, [chart, lines]);

  return (
    <figure className="flex flex-col gap-1.5">
      <figcaption className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
        <span className="font-medium">{title}</span>
        {lines.map((line) => (
          <span key={line.id} className="flex items-center gap-1.5">
            <span
              aria-hidden
              className={
                line.dashed
                  ? "w-4 border-t border-dashed"
                  : "h-0.5 w-4 rounded-full"
              }
              style={
                line.dashed
                  ? { borderColor: line.color }
                  : { background: line.color }
              }
            />
            {line.label}
          </span>
        ))}
      </figcaption>
      <Chart ref={setChart} options={options} className="h-56">
        {lines.map((line, index) => (
          <ReturnSeries
            key={line.id}
            line={line}
            markers={index === lines.length - 1 ? markers : undefined}
          />
        ))}
      </Chart>
    </figure>
  );
}

/** A run's account against holding the listing, out of sample marked where it starts. */
export function EquityChart({
  capital,
  equity,
  holding,
  split,
}: {
  capital: number;
  equity: SessionValue[];
  holding: SessionValue[];
  split: string | null;
}) {
  const { t } = useTranslation();
  const colors = usePaletteColors();

  const lines = useMemo(
    () => [
      {
        id: "holding",
        label: t("backtests.report.holding"),
        color: LINE_COLORS.holding,
        dashed: true,
        capital,
        values: holding,
      },
      {
        id: "strategy",
        label: t("backtests.report.strategy"),
        color: colors.accent,
        capital,
        values: equity,
      },
    ],
    [t, colors.accent, capital, equity, holding]
  );

  return (
    <ReturnChart
      title={t("backtests.report.equity")}
      lines={lines}
      split={split}
    />
  );
}
