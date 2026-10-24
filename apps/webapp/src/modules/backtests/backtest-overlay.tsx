import { useMemo } from "react";

import { useQuery } from "@tanstack/react-query";
import { LineSeries } from "lightweight-charts";
import type {
  LineSeriesPartialOptions,
  SeriesMarker,
  Time,
} from "lightweight-charts";
import { useTranslation } from "react-i18next";

import type { BacktestSetup } from "@solyx/api/backtests";
import { barTime } from "@solyx/core/candles";
import type { Candle, Interval } from "@solyx/core/candles";
import { symbolKey } from "@solyx/core/market";
import type { SymbolRef } from "@solyx/core/market";
import { Series } from "@solyx/trading-chart/series";
import { utcTimestamp } from "@solyx/trading-chart/time-format";

import { usePaletteColors } from "../../app/theme.ts";

import { backtestQuery } from "./backtest-query.ts";
import { useBacktestStore } from "./backtest-store.ts";

// The series only carries the marks: it follows the closes, so it never moves the scale.
const CARRIER_OPTIONS: LineSeriesPartialOptions = {
  color: "transparent",
  lineVisible: false,
  priceLineVisible: false,
  lastValueVisible: false,
  crosshairMarkerVisible: false,
};

function RunMarks({
  setup,
  candles,
}: {
  setup: BacktestSetup;
  candles: Candle[];
}) {
  const { t } = useTranslation();
  const colors = usePaletteColors();
  const { data } = useQuery(backtestQuery(setup));
  const { market } = setup.symbol;

  const carried = useMemo(
    () =>
      candles.map((candle) => ({
        time: utcTimestamp(candle.time),
        value: candle.close,
      })),
    [candles]
  );

  const markers = useMemo(() => {
    if (!data) return undefined;

    // A trade is timed as its bar is on the exchange's clock, which the chart's bars are read back to.
    const bars = new Map(
      candles.map((candle) => [
        barTime(market, setup.interval, candle.time),
        candle.time,
      ])
    );

    const marks: SeriesMarker<Time>[] = [];

    const mark = (at: string | null, buy: boolean) => {
      const time = at === null ? undefined : bars.get(at);

      if (time === undefined) return;

      marks.push({
        time: utcTimestamp(time),
        position: buy ? "belowBar" : "aboveBar",
        // Lightweight Charts' own field; a computed key keeps it apart from the names we choose.
        ["shape"]: buy ? "arrowUp" : "arrowDown",
        color: colors.muted,
        text: t(buy ? "backtests.chart.buy" : "backtests.chart.sell"),
      });
    };

    for (const trade of data.trades) {
      mark(trade.entryTime, true);
      mark(trade.exitTime, false);
    }

    return marks.toSorted(
      (one, other) => Number(one.time) - Number(other.time)
    );
  }, [data, candles, market, setup.interval, colors, t]);

  return (
    <Series
      definition={LineSeries}
      data={carried}
      options={CARRIER_OPTIONS}
      markers={markers}
    />
  );
}

/**
 * Where the run the listing's backtest panel shows bought and sold, in pencil since none of it
 * traded, on a chart of the bars it ran on while the panel says to mark them.
 */
export function BacktestOverlay({
  symbol,
  interval,
  candles,
}: {
  symbol: SymbolRef;
  interval: Interval;
  candles: Candle[];
}) {
  const setup = useBacktestStore(
    (state) => state.listings[symbolKey(symbol)]?.run
  );

  const onChart = useBacktestStore((state) => state.onChart);

  if (!setup || !onChart || setup.interval !== interval) return null;

  return <RunMarks setup={setup} candles={candles} />;
}
