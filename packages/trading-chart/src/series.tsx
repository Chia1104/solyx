import { useImperativeHandle, useLayoutEffect, useState } from "react";
import type { Ref } from "react";

import type {
  CreatePriceLineOptions,
  DeepPartial,
  ISeriesApi,
  PriceScaleOptions,
  SeriesDataItemTypeMap,
  SeriesDefinition,
  SeriesPartialOptionsMap,
  SeriesType,
  Time,
} from "lightweight-charts";

import { isChartRemoved, useChart } from "./chart.tsx";

export interface SeriesProps<T extends SeriesType> {
  definition: SeriesDefinition<T>;
  data: SeriesDataItemTypeMap<Time>[T][];
  options?: SeriesPartialOptionsMap[T];
  /** Horizontal reference levels, such as RSI's 30 and 70. */
  priceLines?: CreatePriceLineOptions[];
  /**
   * Pane to draw in; a missing pane is created.
   * @default 0
   */
  pane?: number;
  /** Height of this series' pane relative to the other panes. */
  paneStretch?: number;
  /** Options for the price scale this series is drawn against, shared with its other series. */
  priceScale?: DeepPartial<PriceScaleOptions>;
  ref?: Ref<ISeriesApi<T> | null>;
}

/**
 * One series on the enclosing chart. It is recreated only when the definition or pane changes;
 * options, data, price lines and price scale options are applied to the live series.
 */
export function Series<T extends SeriesType>({
  definition,
  data,
  options,
  priceLines,
  pane = 0,
  paneStretch,
  priceScale,
  ref,
}: SeriesProps<T>) {
  const chart = useChart();
  const [series, setSeries] = useState<ISeriesApi<T> | null>(null);

  useLayoutEffect(() => {
    const instance = chart.addSeries(definition, undefined, pane);

    setSeries(instance);

    return () => {
      setSeries(null);

      if (!isChartRemoved(chart)) chart.removeSeries(instance);
    };
  }, [chart, definition, pane]);

  useLayoutEffect(() => {
    if (series && options) series.applyOptions(options);
  }, [series, options]);

  useLayoutEffect(() => {
    series?.setData(data);
  }, [series, data]);

  useLayoutEffect(() => {
    if (!series || !priceLines) return;

    const lines = priceLines.map((line) => series.createPriceLine(line));

    return () => {
      if (isChartRemoved(chart)) return;

      for (const line of lines) series.removePriceLine(line);
    };
  }, [chart, series, priceLines]);

  useLayoutEffect(() => {
    if (series && paneStretch !== undefined) {
      series.getPane().setStretchFactor(paneStretch);
    }
  }, [series, paneStretch]);

  useLayoutEffect(() => {
    if (series && priceScale) series.priceScale().applyOptions(priceScale);
  }, [series, priceScale]);

  useImperativeHandle<ISeriesApi<T> | null, ISeriesApi<T> | null>(
    ref,
    () => series,
    [series]
  );

  return null;
}
