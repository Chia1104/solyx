import { useMemo } from "react";

import { HistogramSeries, LineSeries } from "lightweight-charts";
import type {
  DeepPartial,
  HistogramSeriesPartialOptions,
  LineSeriesPartialOptions,
  PriceScaleOptions,
  UTCTimestamp,
} from "lightweight-charts";

import type { Candle } from "@solyx/core/candles";
import { bollinger, kd, macd, rsi } from "@solyx/core/indicators";
import { Series } from "@solyx/trading-chart/series";

import { LINE_COLORS } from "./chart-palette.ts";
import type { DirectionColors } from "./chart-palette.ts";
import {
  LOWER_PANE_STRETCH,
  level,
  lineOptions,
  toHistogram,
  toLine,
} from "./chart-series.ts";

const BOLLINGER_OPTIONS = lineOptions(LINE_COLORS.bollinger);

const FAST_OPTIONS = lineOptions(LINE_COLORS.fast);

const SLOW_OPTIONS = lineOptions(LINE_COLORS.slow);

const HISTOGRAM_OPTIONS: HistogramSeriesPartialOptions = {
  priceLineVisible: false,
  lastValueVisible: false,
};

// RSI and KD are bounded, so their panes show exactly 0 to 100.
function boundedLineOptions(color: string): LineSeriesPartialOptions {
  return {
    ...lineOptions(color),
    autoscaleInfoProvider: () => ({
      priceRange: { minValue: 0, maxValue: 100 },
    }),
  };
}

const RSI_OPTIONS = boundedLineOptions(LINE_COLORS.oscillator);

const K_OPTIONS = boundedLineOptions(LINE_COLORS.fast);

const D_OPTIONS = boundedLineOptions(LINE_COLORS.slow);

const BOUNDED_SCALE: DeepPartial<PriceScaleOptions> = {
  scaleMargins: { top: 0.1, bottom: 0.1 },
};

const RSI_LEVELS = [level(30), level(70)];

const KD_LEVELS = [level(20), level(80)];

export function BollingerBands({
  times,
  closes,
}: {
  times: UTCTimestamp[];
  closes: number[];
}) {
  const bands = useMemo(() => {
    const { upper, middle, lower } = bollinger(closes);

    return {
      upper: toLine(times, upper),
      middle: toLine(times, middle),
      lower: toLine(times, lower),
    };
  }, [times, closes]);

  return Object.entries(bands).map(([band, data]) => (
    <Series
      key={band}
      definition={LineSeries}
      data={data}
      options={BOLLINGER_OPTIONS}
    />
  ));
}

export function MacdPane({
  times,
  closes,
  direction,
  pane,
}: {
  times: UTCTimestamp[];
  closes: number[];
  direction: DirectionColors;
  pane: number;
}) {
  const lines = useMemo(() => {
    const result = macd(closes);

    return {
      histogram: toHistogram(
        times,
        result.histogram,
        direction.rise.faded,
        direction.fall.faded
      ),
      macd: toLine(times, result.macd),
      signal: toLine(times, result.signal),
    };
  }, [times, closes, direction]);

  return (
    <>
      <Series
        definition={HistogramSeries}
        data={lines.histogram}
        options={HISTOGRAM_OPTIONS}
        pane={pane}
        paneStretch={LOWER_PANE_STRETCH}
      />
      <Series
        definition={LineSeries}
        data={lines.macd}
        options={FAST_OPTIONS}
        pane={pane}
      />
      <Series
        definition={LineSeries}
        data={lines.signal}
        options={SLOW_OPTIONS}
        pane={pane}
      />
    </>
  );
}

export function RsiPane({
  times,
  closes,
  pane,
}: {
  times: UTCTimestamp[];
  closes: number[];
  pane: number;
}) {
  const data = useMemo(() => toLine(times, rsi(closes)), [times, closes]);

  return (
    <Series
      definition={LineSeries}
      data={data}
      options={RSI_OPTIONS}
      priceLines={RSI_LEVELS}
      pane={pane}
      paneStretch={LOWER_PANE_STRETCH}
      priceScale={BOUNDED_SCALE}
    />
  );
}

export function KdPane({
  times,
  candles,
  pane,
}: {
  times: UTCTimestamp[];
  candles: Candle[];
  pane: number;
}) {
  const lines = useMemo(() => {
    const { k, d } = kd(candles);

    return { k: toLine(times, k), d: toLine(times, d) };
  }, [times, candles]);

  return (
    <>
      <Series
        definition={LineSeries}
        data={lines.k}
        options={K_OPTIONS}
        priceLines={KD_LEVELS}
        pane={pane}
        paneStretch={LOWER_PANE_STRETCH}
        priceScale={BOUNDED_SCALE}
      />
      <Series
        definition={LineSeries}
        data={lines.d}
        options={D_OPTIONS}
        pane={pane}
      />
    </>
  );
}
