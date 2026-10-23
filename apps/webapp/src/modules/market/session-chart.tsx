import { useEffect, useMemo } from "react";
import type { ReactNode } from "react";

import {
  BaselineSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
} from "lightweight-charts";
import type {
  AutoscaleInfo,
  BaselineSeriesPartialOptions,
  ChartOptions,
  DeepPartial,
  HistogramSeriesPartialOptions,
} from "lightweight-charts";
import { useTranslation } from "react-i18next";

import { candleDate } from "@solyx/core/candles";
import type { Candle } from "@solyx/core/candles";
import { vwap } from "@solyx/core/indicators";
import { MARKET_TIME_ZONE } from "@solyx/core/market";
import type { Market } from "@solyx/core/market";
import { regularHours } from "@solyx/core/session";
import { Chart, useChart } from "@solyx/trading-chart/chart";
import { Series } from "@solyx/trading-chart/series";
import {
  exchangeTimeFormat,
  utcTimestamp,
} from "@solyx/trading-chart/time-format";

import { usePaletteColors } from "../../app/theme.ts";

import { ChartLegend } from "./chart-legend.tsx";
import { LINE_COLORS } from "./chart-palette.ts";
import {
  LOWER_PANE_STRETCH,
  PRICE_PANE_STRETCH,
  toLine,
} from "./chart-series.ts";
import { useDirectionColors } from "./price-colors.ts";

const MINUTE_S = 60;

// A quiet session still shows its moves at this share of the reference above and below it.
const LEAST_SPAN = 0.005;

const VWAP_OPTIONS = {
  color: LINE_COLORS.vwap,
  lineWidth: 2 as const,
  priceLineVisible: false,
  lastValueVisible: false,
  crosshairMarkerVisible: false,
};

const VOLUME_OPTIONS: HistogramSeriesPartialOptions = {
  priceFormat: { type: "volume" },
  priceLineVisible: false,
  lastValueVisible: false,
};

/** The newest session's minute bars, and the close of the session before them where the bars reach back to it. */
function newestSession(market: Market, candles: Candle[]) {
  const last = candles.at(-1);

  if (!last) return null;

  const date = candleDate(market, last.time);

  const first = candles.findIndex(
    (candle) => candleDate(market, candle.time) === date
  );

  return {
    date,
    bars: candles.slice(first),
    previousClose: first > 0 ? candles[first - 1].close : null,
  };
}

/** Shows the whole session from the open to the close, and keeps it there. */
function FitSession({ date }: { date: string }) {
  const chart = useChart();

  useEffect(() => {
    chart.timeScale().fitContent();
  }, [chart, date]);

  return null;
}

/**
 * The newest session on minute bars, as Taiwan's traders read it: the price shaded above and below
 * its reference, the session's average price and its volume, across the session's hours, with the
 * scale even about the reference.
 */
export function SessionChart({
  candles,
  market,
  reference,
  overlay,
}: {
  /** Minute bars, oldest first. */
  candles: Candle[];
  market: Market;
  /** The session's reference price, where known; else the close before it. */
  reference: number | null;
  /** What else to draw on the price pane, given the session's bars. */
  overlay?: (bars: Candle[]) => ReactNode;
}) {
  const { t, i18n } = useTranslation();
  const colors = usePaletteColors();
  const direction = useDirectionColors(market);

  const session = useMemo(
    () => newestSession(market, candles),
    [market, candles]
  );

  const base =
    reference ?? session?.previousClose ?? session?.bars[0]?.open ?? null;

  const options = useMemo<DeepPartial<ChartOptions>>(() => {
    const time = exchangeTimeFormat(
      MARKET_TIME_ZONE[market],
      i18n.language,
      true
    );

    return {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: colors.muted,
        panes: { separatorColor: colors.separator },
      },
      grid: {
        vertLines: { color: colors.separator },
        horzLines: { color: colors.separator },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderVisible: false },
      // The session is the whole view, so it neither scrolls nor zooms.
      handleScroll: false,
      handleScale: false,
      timeScale: {
        borderVisible: false,
        timeVisible: true,
        fixLeftEdge: true,
        fixRightEdge: true,
        tickMarkFormatter: time.tickMarkFormatter,
      },
      localization: {
        locale: i18n.language,
        timeFormatter: time.timeFormatter,
      },
    };
  }, [colors, market, i18n.language]);

  const priceOptions = useMemo<BaselineSeriesPartialOptions | undefined>(() => {
    if (base === null) return undefined;

    return {
      baseValue: { type: "price", price: base },
      topLineColor: direction.rise.solid,
      topFillColor1: direction.rise.faded,
      topFillColor2: "transparent",
      bottomLineColor: direction.fall.solid,
      bottomFillColor1: "transparent",
      bottomFillColor2: direction.fall.faded,
      lineWidth: 2,
      // Even about the reference, so a rise and a fall of one size look alike.
      autoscaleInfoProvider: (original: () => AutoscaleInfo | null) => {
        const info = original();

        if (!info?.priceRange) return info;

        const span = Math.max(
          Math.abs(info.priceRange.maxValue - base),
          Math.abs(base - info.priceRange.minValue),
          base * LEAST_SPAN
        );

        return {
          ...info,
          priceRange: { minValue: base - span, maxValue: base + span },
        };
      },
    };
  }, [base, direction]);

  const referenceLine = useMemo(
    () =>
      base === null
        ? undefined
        : [
            {
              price: base,
              title: t("chart.reference"),
              color: colors.muted,
              lineWidth: 1 as const,
              lineStyle: LineStyle.Dashed,
              axisLabelVisible: true,
            },
          ],
    [base, colors, t]
  );

  const series = useMemo(() => {
    if (!session) return null;

    const { bars, date } = session;
    const times = bars.map((bar) => utcTimestamp(bar.time));
    const average = vwap(market, bars);
    const { close } = regularHours(market, date);

    // Minutes still to trade hold the axis open to the close.
    const rest = [];

    for (
      let time = (bars.at(-1)?.time ?? close) + MINUTE_S;
      time <= close;
      time += MINUTE_S
    ) {
      rest.push({ time: utcTimestamp(time) });
    }

    return {
      bars,
      average,
      price: [
        ...bars.map((bar, i) => ({ time: times[i], value: bar.close })),
        ...rest,
      ],
      vwap: [...toLine(times, average), ...rest],
      volume: bars.map((bar, i) => ({
        time: times[i],
        value: bar.volume,
        color:
          bar.close >= bar.open ? direction.rise.faded : direction.fall.faded,
      })),
    };
  }, [session, market, direction]);

  if (!session || !series || !priceOptions) return null;

  return (
    <Chart options={options} className="size-full">
      <Series
        definition={BaselineSeries}
        data={series.price}
        options={priceOptions}
        priceLines={referenceLine}
        paneStretch={PRICE_PANE_STRETCH}
      />
      <Series
        definition={LineSeries}
        data={series.vwap}
        options={VWAP_OPTIONS}
      />
      {overlay?.(series.bars)}
      <Series
        definition={HistogramSeries}
        data={series.volume}
        options={VOLUME_OPTIONS}
        pane={1}
        paneStretch={LOWER_PANE_STRETCH}
      />
      <FitSession date={session.date} />
      <ChartLegend
        candles={series.bars}
        lines={[
          { label: "VWAP", color: LINE_COLORS.vwap, values: series.average },
        ]}
      />
    </Chart>
  );
}
