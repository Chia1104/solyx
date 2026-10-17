import { useMemo } from "react";

import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  LineSeries,
  LineStyle,
} from "lightweight-charts";
import type {
  CandlestickSeriesPartialOptions,
  ChartOptions,
  CreatePriceLineOptions,
  DeepPartial,
  LineSeriesPartialOptions,
} from "lightweight-charts";

import type { Candle } from "@solyx/core/candles";
import { sma } from "@solyx/core/indicators";
import { MARKET_TIME_ZONE, Market } from "@solyx/core/market";
import { Chart } from "@solyx/trading-chart/chart";
import type { PriceBand } from "@solyx/trading-chart/price-bands";
import { Series } from "@solyx/trading-chart/series";
import {
  exchangeTimeFormat,
  utcTimestamp,
} from "@solyx/trading-chart/time-format";

import { useSheetColors } from "../../lib/use-sheet-colors.ts";
import type { SheetColors } from "../../lib/use-sheet-colors.ts";

import type { Forecast } from "./script.ts";

/** The app's colours for the week, month and quarter lines. */
const MOVING_AVERAGES = [
  { period: 5, color: "#f59e0b" },
  { period: 20, color: "#a855f7" },
  { period: 60, color: "#14b8a6" },
];

const FORECAST_ROOM = 12;

const TIME = exchangeTimeFormat(MARKET_TIME_ZONE[Market.TW], "en-US", false);

export interface LimitLine {
  price: number;
  /** Signed lines are drawn in ink; drafted ones stay dashed pencil. */
  signed: boolean;
}

export interface PriceChartProps {
  candles: readonly Candle[];
  /** The listing's tick at its last price, which the price scale is quoted to. */
  tick: number;
  forecast?: Forecast;
  limit?: LimitLine;
  className?: string;
}

function chartOptions(colors: SheetColors): DeepPartial<ChartOptions> {
  return {
    layout: {
      background: { type: ColorType.Solid, color: "transparent" },
      textColor: colors.mutedForeground,
      fontFamily: "Archivo Variable, system-ui, sans-serif",
    },
    grid: {
      vertLines: { color: `${colors.border}66` },
      horzLines: { color: `${colors.border}66` },
    },
    crosshair: { mode: CrosshairMode.Normal },
    rightPriceScale: { borderVisible: false },
    timeScale: {
      borderVisible: false,
      // Room after the last bar for the forecast's bands.
      rightOffset: FORECAST_ROOM,
      tickMarkFormatter: TIME.tickMarkFormatter,
    },
    localization: { locale: "en-US", timeFormatter: TIME.timeFormatter },
    handleScroll: false,
    handleScale: false,
  };
}

/** The forecast's scenarios as pencilled bands to the right of the last bar. */
function forecastBands(forecast: Forecast, colors: SheetColors): PriceBand[] {
  // Open-ended scenarios reach well past the prices in view; bands never widen the scale.
  const reach = forecast.from * 0.5;

  return forecast.scenarios.map((scenario, index) => ({
    low: scenario.low ?? forecast.from - reach,
    high: scenario.high ?? forecast.from + reach,
    color: `${colors.graphite}${index % 2 === 0 ? "26" : "40"}`,
    width: 0.13,
    label: `${Math.round(scenario.probability * 100)}%`,
    labelColor: colors.foreground,
  }));
}

/** The demo's daily chart, drawn through the same bindings the app uses. */
export function PriceChart({
  candles,
  tick,
  forecast,
  limit,
  className,
}: PriceChartProps) {
  const colors = useSheetColors();

  const bars = useMemo(
    () =>
      candles.map(({ time, open, high, low, close }) => ({
        time: utcTimestamp(time),
        open,
        high,
        low,
        close,
      })),
    [candles]
  );

  const averages = useMemo(() => {
    const closes = candles.map((candle) => candle.close);

    return MOVING_AVERAGES.map(({ period, color }) => ({
      period,
      options: {
        color,
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      } satisfies LineSeriesPartialOptions,
      data: sma(closes, period).flatMap((value, index) =>
        value === null
          ? []
          : [{ time: utcTimestamp(candles[index].time), value }]
      ),
    }));
  }, [candles]);

  const options = useMemo(() => colors && chartOptions(colors), [colors]);

  const candleOptions = useMemo<CandlestickSeriesPartialOptions | undefined>(
    () =>
      colors
        ? {
            // Taiwan quotes a rise in red and a fall in green.
            upColor: colors.candleRise,
            downColor: colors.candleFall,
            wickUpColor: colors.candleRise,
            wickDownColor: colors.candleFall,
            borderVisible: false,
            priceFormat: {
              type: "price",
              minMove: tick,
              precision: Math.max(0, -Math.floor(Math.log10(tick))),
            },
          }
        : undefined,
    [colors, tick]
  );

  const bands = useMemo(
    () => (colors && forecast ? forecastBands(forecast, colors) : []),
    [colors, forecast]
  );

  const priceLines = useMemo<CreatePriceLineOptions[]>(
    () =>
      colors && limit
        ? [
            {
              price: limit.price,
              color: limit.signed ? colors.primary : colors.graphite,
              lineWidth: limit.signed ? 2 : 1,
              lineStyle: limit.signed ? LineStyle.Solid : LineStyle.Dashed,
              axisLabelVisible: true,
              title: limit.signed ? "Buy, submitted" : "Buy, proposed",
            },
          ]
        : [],
    [colors, limit]
  );

  if (!options || !candleOptions) return <div className={className} />;

  return (
    <Chart className={className} options={options}>
      <Series
        definition={CandlestickSeries}
        data={bars}
        options={candleOptions}
        bands={bands}
        priceLines={priceLines}
      />
      {averages.map(({ period, options: lineOptions, data }) => (
        <Series
          key={period}
          definition={LineSeries}
          data={data}
          options={lineOptions}
        />
      ))}
    </Chart>
  );
}
