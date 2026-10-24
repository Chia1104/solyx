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

// Returns are drawn to a hundredth of a percent.
const RETURN_MOVE = 0.0001;

/**
 * A run's account against holding the listing, each as its return on the capital at each
 * session's close, the out-of-sample stretch marked where it starts.
 */
export function EquityChart({
  capital,
  equity,
  holding,
  split,
}: {
  capital: number;
  equity: SessionValue[];
  holding: SessionValue[];
  /** The first session out of sample, where there is a split. */
  split: string | null;
}) {
  const { t, i18n } = useTranslation();
  const colors = usePaletteColors();
  const format = numberFormats(i18n.language);

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

  const series = useMemo(() => {
    const priceFormat = {
      type: "custom" as const,
      minMove: RETURN_MOVE,
      formatter: (value: number) => format.percentChange.format(value),
    };

    const strategy: LineSeriesPartialOptions = {
      color: colors.accent,
      lineWidth: 2,
      priceFormat,
    };

    const held: LineSeriesPartialOptions = {
      color: LINE_COLORS.holding,
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      priceLineVisible: false,
      priceFormat,
    };

    return { strategy, held };
  }, [colors, format]);

  const data = useMemo(() => {
    const returns = (values: SessionValue[]) =>
      values.map(({ date, value }) => ({
        time: date,
        value: value / capital - 1,
      }));

    return { strategy: returns(equity), held: returns(holding) };
  }, [equity, holding, capital]);

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

  const [chart, setChart] = useState<IChartApi | null>(null);

  // The whole run is in view, so the stretches read side by side; the series set their data first.
  useEffect(() => {
    chart?.timeScale().fitContent();
  }, [chart, data]);

  return (
    <figure className="flex flex-col gap-1.5">
      <figcaption className="flex items-center gap-4 text-xs text-muted">
        <span className="font-medium">{t("backtests.report.equity")}</span>
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="h-0.5 w-4 rounded-full"
            style={{ background: colors.accent }}
          />
          {t("backtests.report.strategy")}
        </span>
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="w-4 border-t border-dashed"
            style={{ borderColor: LINE_COLORS.holding }}
          />
          {t("backtests.report.holding")}
        </span>
      </figcaption>
      <Chart ref={setChart} options={options} className="h-56">
        <Series
          definition={LineSeries}
          data={data.held}
          options={series.held}
        />
        <Series
          definition={LineSeries}
          data={data.strategy}
          options={series.strategy}
          markers={markers}
        />
      </Chart>
    </figure>
  );
}
