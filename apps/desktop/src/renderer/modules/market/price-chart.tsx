import { useMemo } from "react";

import { mapValues } from "es-toolkit";
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
} from "lightweight-charts";
import type {
  CandlestickSeriesPartialOptions,
  ChartOptions,
  DeepPartial,
  HistogramSeriesPartialOptions,
} from "lightweight-charts";
import { useTranslation } from "react-i18next";

import { isIntraday } from "@solyx/core/candles";
import type { Candle, Interval } from "@solyx/core/candles";
import { sma } from "@solyx/core/indicators";
import { MARKET_TIME_ZONE } from "@solyx/core/market";
import type { Market } from "@solyx/core/market";
import { Chart } from "@solyx/trading-chart/chart";
import { Series } from "@solyx/trading-chart/series";
import {
  exchangeTimeFormat,
  utcTimestamp,
} from "@solyx/trading-chart/time-format";

import { useIsDarkTheme } from "../../app/theme.ts";

import { ChartLegend } from "./chart-legend.tsx";
import {
  DARK_PALETTE,
  DIRECTION_COLORS,
  LIGHT_PALETTE,
  LINE_COLORS,
} from "./chart-palette.ts";
import {
  LOWER_PANE_STRETCH,
  PRICE_PANE_STRETCH,
  lineOptions,
  toLine,
} from "./chart-series.ts";
import {
  BollingerBands,
  KdPane,
  MacdPane,
  RsiPane,
} from "./indicator-panes.tsx";
import { ChartIndicator, useIndicatorStore } from "./indicator-store.ts";

// Oscillators each get a pane below volume, in this order.
const PANE_INDICATORS: readonly ChartIndicator[] = [
  ChartIndicator.Macd,
  ChartIndicator.Rsi,
  ChartIndicator.Kd,
];

const MOVING_AVERAGES = [
  { period: 5, color: LINE_COLORS.ma5 },
  { period: 10, color: LINE_COLORS.ma10 },
  { period: 20, color: LINE_COLORS.ma20 },
  { period: 60, color: LINE_COLORS.ma60 },
].map((average) => ({ ...average, options: lineOptions(average.color) }));

const CANDLE_OPTIONS: Record<Market, CandlestickSeriesPartialOptions> =
  mapValues(DIRECTION_COLORS, ({ rise, fall }) => ({
    upColor: rise.solid,
    downColor: fall.solid,
    wickUpColor: rise.solid,
    wickDownColor: fall.solid,
    borderVisible: false,
  }));

const VOLUME_OPTIONS: HistogramSeriesPartialOptions = {
  priceFormat: { type: "volume" },
  priceLineVisible: false,
  lastValueVisible: false,
};

/** Indicators compute only while enabled, each in its own component. */
export function PriceChart({
  candles,
  market,
  interval,
}: {
  candles: Candle[];
  market: Market;
  interval: Interval;
}) {
  const { i18n } = useTranslation();
  const isDark = useIsDarkTheme();
  const enabled = useIndicatorStore((state) => state.enabled);
  const direction = DIRECTION_COLORS[market];

  const options = useMemo<DeepPartial<ChartOptions>>(() => {
    const palette = isDark ? DARK_PALETTE : LIGHT_PALETTE;

    const time = exchangeTimeFormat(
      MARKET_TIME_ZONE[market],
      i18n.language,
      isIntraday(interval)
    );

    return {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: palette.text,
        panes: { separatorColor: palette.grid },
      },
      grid: {
        vertLines: { color: palette.grid },
        horzLines: { color: palette.grid },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderVisible: false },
      timeScale: {
        borderVisible: false,
        timeVisible: isIntraday(interval),
        tickMarkFormatter: time.tickMarkFormatter,
      },
      localization: {
        locale: i18n.language,
        timeFormatter: time.timeFormatter,
      },
    };
  }, [isDark, market, interval, i18n.language]);

  const times = useMemo(
    () => candles.map((candle) => utcTimestamp(candle.time)),
    [candles]
  );

  const closes = useMemo(
    () => candles.map((candle) => candle.close),
    [candles]
  );

  const bars = useMemo(
    () => ({
      candles: candles.map((candle, i) => ({
        time: times[i],
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
      })),
      volume: candles.map((candle, i) => ({
        time: times[i],
        value: candle.volume,
        color:
          candle.close >= candle.open
            ? direction.rise.faded
            : direction.fall.faded,
      })),
    }),
    [candles, times, direction]
  );

  const showMovingAverages = enabled.includes(ChartIndicator.MovingAverage);

  // The legend reads the same values, so moving averages are computed here rather than in a pane.
  const movingAverages = useMemo(
    () =>
      showMovingAverages
        ? MOVING_AVERAGES.map((average) => {
            const values = sma(closes, average.period);

            return { ...average, values, data: toLine(times, values) };
          })
        : [],
    [showMovingAverages, closes, times]
  );

  // Volume takes pane 1; enabled oscillators follow it without gaps.
  const oscillators = PANE_INDICATORS.filter((indicator) =>
    enabled.includes(indicator)
  );

  const paneOf = (indicator: ChartIndicator) =>
    2 + oscillators.indexOf(indicator);

  return (
    <Chart options={options} className="size-full">
      <Series
        definition={CandlestickSeries}
        data={bars.candles}
        options={CANDLE_OPTIONS[market]}
        paneStretch={PRICE_PANE_STRETCH}
      />
      {movingAverages.map((average) => (
        <Series
          key={average.period}
          definition={LineSeries}
          data={average.data}
          options={average.options}
        />
      ))}
      {enabled.includes(ChartIndicator.Bollinger) ? (
        <BollingerBands times={times} closes={closes} />
      ) : null}
      <Series
        definition={HistogramSeries}
        data={bars.volume}
        options={VOLUME_OPTIONS}
        pane={1}
        paneStretch={LOWER_PANE_STRETCH}
      />
      {oscillators.includes(ChartIndicator.Macd) ? (
        <MacdPane
          times={times}
          closes={closes}
          direction={direction}
          pane={paneOf(ChartIndicator.Macd)}
        />
      ) : null}
      {oscillators.includes(ChartIndicator.Rsi) ? (
        <RsiPane
          times={times}
          closes={closes}
          pane={paneOf(ChartIndicator.Rsi)}
        />
      ) : null}
      {oscillators.includes(ChartIndicator.Kd) ? (
        <KdPane
          times={times}
          candles={candles}
          pane={paneOf(ChartIndicator.Kd)}
        />
      ) : null}
      <ChartLegend
        candles={candles}
        lines={movingAverages.map((average) => ({
          label: `MA${average.period}`,
          color: average.color,
          values: average.values,
        }))}
      />
    </Chart>
  );
}
