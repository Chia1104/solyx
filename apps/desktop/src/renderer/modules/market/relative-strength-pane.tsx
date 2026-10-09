import { useEffect, useMemo } from "react";

import { useInfiniteQuery } from "@tanstack/react-query";
import { LineSeries } from "lightweight-charts";
import type { UTCTimestamp } from "lightweight-charts";

import { Interval, alignedCloses } from "@solyx/core/candles";
import type { Candle } from "@solyx/core/candles";
import {
  RELATIVE_STRENGTH_PERIODS,
  relativeReturn,
} from "@solyx/core/indicators";
import { BENCHMARK } from "@solyx/core/market";
import type { Market } from "@solyx/core/market";
import { Series } from "@solyx/trading-chart/series";

import { candlesQuery } from "./candles-query.ts";
import { MOVING_AVERAGE_COLORS } from "./chart-palette.ts";
import {
  LOWER_PANE_STRETCH,
  level,
  lineOptions,
  toLine,
} from "./chart-series.ts";

// Each period takes the colour of the moving average as long: the month, quarter and half-year lines.
const COLORS = [
  MOVING_AVERAGE_COLORS.short[2],
  MOVING_AVERAGE_COLORS.long[0],
  MOVING_AVERAGE_COLORS.long[1],
];

// A pane's titles ride its last values on the price scale, since the panes carry no legend.
const LINES = RELATIVE_STRENGTH_PERIODS.map((period, index) => ({
  period,
  options: {
    ...lineOptions(COLORS[index]),
    title: `RS${period}`,
    lastValueVisible: true,
  },
}));

// Zero is where the listing kept pace with the index.
const EVEN = [level(0)];

/**
 * How many percentage points a daily listing outran its market's index over each of
 * `RELATIVE_STRENGTH_PERIODS`, in pane `pane`. The index reads back as far as the listing's
 * bars do; nothing is drawn until it loads.
 */
export function RelativeStrengthPane({
  market,
  candles,
  times,
  pane,
}: {
  market: Market;
  candles: Candle[];
  times: UTCTimestamp[];
  pane: number;
}) {
  const {
    data,
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
    fetchNextPage,
  } = useInfiniteQuery(candlesQuery(BENCHMARK[market].symbol, Interval.OneDay));

  const oldest = candles[0]?.time;
  const benchmarkOldest = data?.candles[0]?.time;

  useEffect(() => {
    if (
      oldest !== undefined &&
      benchmarkOldest !== undefined &&
      oldest < benchmarkOldest &&
      hasNextPage &&
      !isFetchingNextPage &&
      !isFetchNextPageError
    ) {
      void fetchNextPage();
    }
  }, [
    oldest,
    benchmarkOldest,
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
    fetchNextPage,
  ]);

  const lines = useMemo(() => {
    if (!data) return null;

    const closes = candles.map((candle) => candle.close);
    const benchmark = alignedCloses(candles, data.candles);

    return LINES.map((line) => ({
      ...line,
      data: toLine(times, relativeReturn(closes, benchmark, line.period)),
    }));
  }, [data, candles, times]);

  if (!lines) return null;

  return lines.map((line, index) => (
    <Series
      key={line.period}
      definition={LineSeries}
      data={line.data}
      options={line.options}
      priceLines={index === 0 ? EVEN : undefined}
      pane={pane}
      paneStretch={index === 0 ? LOWER_PANE_STRETCH : undefined}
    />
  ));
}
