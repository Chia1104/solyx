import { useMemo } from "react";
import type { ReactNode } from "react";

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
  LineWidth,
} from "lightweight-charts";
import { useTranslation } from "react-i18next";

import { Interval, candleDate, isIntraday } from "@solyx/core/candles";
import type { Candle } from "@solyx/core/candles";
import { MOVING_AVERAGE_PERIODS, sma, vwap } from "@solyx/core/indicators";
import { MARKET_TIME_ZONE } from "@solyx/core/market";
import type { Market } from "@solyx/core/market";
import { Chart } from "@solyx/trading-chart/chart";
import { Series } from "@solyx/trading-chart/series";
import {
  exchangeTimeFormat,
  utcTimestamp,
} from "@solyx/trading-chart/time-format";

import { usePaletteColors } from "../../app/theme.ts";

import { ChartLegend } from "./chart-legend.tsx";
import { LINE_COLORS, MOVING_AVERAGE_COLORS } from "./chart-palette.ts";
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
  VolumeRatioPane,
} from "./indicator-panes.tsx";
import {
  ChartIndicator,
  DAILY_INDICATORS,
  useIndicatorStore,
} from "./indicator-store.ts";
import { useDirectionColors } from "./price-colors.ts";
import { RelativeStrengthPane } from "./relative-strength-pane.tsx";
import { useLevels } from "./use-levels.ts";

// Indicators drawn apart from price each get a pane below volume, in this order.
const PANE_INDICATORS: readonly ChartIndicator[] = [
  ChartIndicator.Macd,
  ChartIndicator.Rsi,
  ChartIndicator.Kd,
  ChartIndicator.VolumeRatio,
  ChartIndicator.RelativeStrength,
];

function averages(
  periods: readonly number[],
  colors: readonly string[],
  lineWidth: LineWidth
) {
  return periods.map((period, index) => {
    const color = colors[index];

    return { period, color, options: { ...lineOptions(color), lineWidth } };
  });
}

// The long lines are drawn heavier, since they carry the trend the short ones move about.
const MOVING_AVERAGES = {
  short: averages(MOVING_AVERAGE_PERIODS.short, MOVING_AVERAGE_COLORS.short, 1),
  long: averages(MOVING_AVERAGE_PERIODS.long, MOVING_AVERAGE_COLORS.long, 2),
};

// Drawn as heavy as the long lines: it is the session's trend, as they are the market's.
const VWAP_OPTIONS = {
  ...lineOptions(LINE_COLORS.vwap),
  lineWidth: 2 as const,
};

const VOLUME_OPTIONS: HistogramSeriesPartialOptions = {
  priceFormat: { type: "volume" },
  priceLineVisible: false,
  lastValueVisible: false,
};

// Older bars are asked for once this few are left to the left of the view.
const NEAR_OLDEST_BARS = 20;

/** Indicators compute only while enabled, each in its own component. */
export function PriceChart({
  candles,
  market,
  interval,
  onNearOldest,
  children,
  panes,
}: {
  candles: Candle[];
  market: Market;
  interval: Interval;
  /** Called as the view nears the oldest bar, to load older ones. */
  onNearOldest?: () => void;
  /** What else is drawn on the price pane, over the candles. */
  children?: ReactNode;
  /** Panes drawn below the indicators', from `firstPane` on without gaps. */
  panes?: (firstPane: number) => ReactNode;
}) {
  const { i18n } = useTranslation();
  const colors = usePaletteColors();
  const enabled = useIndicatorStore((state) => state.enabled);
  const direction = useDirectionColors(market);

  const options = useMemo<DeepPartial<ChartOptions>>(() => {
    const time = exchangeTimeFormat(
      MARKET_TIME_ZONE[market],
      i18n.language,
      isIntraday(interval)
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
  }, [colors, market, interval, i18n.language]);

  const candleOptions = useMemo<CandlestickSeriesPartialOptions>(
    () => ({
      upColor: direction.rise.solid,
      downColor: direction.fall.solid,
      wickUpColor: direction.rise.solid,
      wickDownColor: direction.fall.solid,
      borderVisible: false,
    }),
    [direction]
  );

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

  const daily = interval === Interval.OneDay;

  const levels = useLevels({ candles, times, closes, market, interval });

  const showVwap =
    isIntraday(interval) && enabled.includes(ChartIndicator.Vwap);

  const vwapLine = useMemo(() => {
    if (!showVwap) return null;

    const values = vwap(market, candles);
    const dates = candles.map((candle) => candleDate(market, candle.time));

    // A point's colour paints the segment after it, so each session's last point leaves the
    // jump to the next session's average undrawn.
    const data = toLine(times, values).map((point, i) =>
      "value" in point && i < dates.length - 1 && dates[i + 1] !== dates[i]
        ? { ...point, color: "transparent" }
        : point
    );

    return { values, data };
  }, [showVwap, market, candles, times]);

  const showShort = enabled.includes(ChartIndicator.MovingAverage);
  const showLong = enabled.includes(ChartIndicator.LongMovingAverage);

  // The legend reads the same values, so moving averages are computed here rather than in a pane.
  const movingAverages = useMemo(
    () =>
      [
        ...(showShort ? MOVING_AVERAGES.short : []),
        ...(showLong ? MOVING_AVERAGES.long : []),
      ].map((average) => {
        const values = sma(closes, average.period);

        return { ...average, values, data: toLine(times, values) };
      }),
    [showShort, showLong, closes, times]
  );

  // Volume takes pane 1; enabled pane indicators follow it without gaps.
  const oscillators = PANE_INDICATORS.filter(
    (indicator) =>
      enabled.includes(indicator) &&
      (daily || !DAILY_INDICATORS.includes(indicator))
  );

  const paneOf = (indicator: ChartIndicator) =>
    2 + oscillators.indexOf(indicator);

  return (
    <Chart
      options={options}
      className="size-full"
      onVisibleLogicalRangeChange={(range) => {
        if (range && range.from < NEAR_OLDEST_BARS) onNearOldest?.();
      }}>
      <Series
        definition={CandlestickSeries}
        data={bars.candles}
        options={candleOptions}
        priceLines={levels.priceLines}
        markers={levels.markers}
        bands={levels.bands}
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
      {vwapLine ? (
        <Series
          definition={LineSeries}
          data={vwapLine.data}
          options={VWAP_OPTIONS}
        />
      ) : null}
      {enabled.includes(ChartIndicator.Bollinger) ? (
        <BollingerBands times={times} closes={closes} />
      ) : null}
      {children}
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
      {oscillators.includes(ChartIndicator.VolumeRatio) ? (
        <VolumeRatioPane
          times={times}
          candles={candles}
          pane={paneOf(ChartIndicator.VolumeRatio)}
        />
      ) : null}
      {oscillators.includes(ChartIndicator.RelativeStrength) ? (
        <RelativeStrengthPane
          market={market}
          candles={candles}
          times={times}
          pane={paneOf(ChartIndicator.RelativeStrength)}
        />
      ) : null}
      {panes?.(2 + oscillators.length)}
      <ChartLegend
        candles={candles}
        lines={[
          ...movingAverages.map((average) => ({
            label: `MA${average.period}`,
            color: average.color,
            values: average.values,
          })),
          ...(vwapLine
            ? [
                {
                  label: "VWAP",
                  color: LINE_COLORS.vwap,
                  values: vwapLine.values,
                },
              ]
            : []),
        ]}
      />
    </Chart>
  );
}
