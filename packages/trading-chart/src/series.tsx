import { useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import type { Ref } from "react";

import { createSeriesMarkers } from "lightweight-charts";
import type {
  CreatePriceLineOptions,
  DeepPartial,
  ISeriesApi,
  ISeriesMarkersPluginApi,
  PriceScaleOptions,
  SeriesDataItemTypeMap,
  SeriesDefinition,
  SeriesMarker,
  SeriesPartialOptionsMap,
  SeriesType,
  Time,
} from "lightweight-charts";

import { isChartRemoved, useChart } from "./chart.tsx";
import { liveTail } from "./live-tail.ts";
import { PriceBands } from "./price-bands.ts";
import type { PriceBand } from "./price-bands.ts";

export interface SeriesProps<T extends SeriesType> {
  definition: SeriesDefinition<T>;
  data: SeriesDataItemTypeMap<Time>[T][];
  options?: SeriesPartialOptionsMap[T];
  /** Horizontal reference levels, such as RSI's 30 and 70. */
  priceLines?: CreatePriceLineOptions[];
  /** Marks on bars, in time order, such as where a close crossed a moving average. */
  markers?: SeriesMarker<Time>[];
  /** Price ranges shaded behind the bars, such as support zones. */
  bands?: PriceBand[];
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
 * options, data, price lines, markers, bands and price scale options are applied to the live
 * series. Data that only moves its last bar, or adds one, goes through `update`, which is
 * cheaper and keeps the view.
 */
export function Series<T extends SeriesType>({
  definition,
  data,
  options,
  priceLines,
  markers,
  bands,
  pane = 0,
  paneStretch,
  priceScale,
  ref,
}: SeriesProps<T>) {
  const chart = useChart();
  const [series, setSeries] = useState<ISeriesApi<T> | null>(null);

  const applied = useRef<{
    series: ISeriesApi<T>;
    data: SeriesDataItemTypeMap<Time>[T][];
  } | null>(null);

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
    if (!series) return;

    const previous =
      applied.current?.series === series ? applied.current.data : undefined;

    const tail = previous && liveTail(previous, data);

    if (tail) {
      for (const item of tail) series.update(item);
    } else {
      series.setData(data);
    }

    applied.current = { series, data };
  }, [series, data]);

  useLayoutEffect(() => {
    if (!series || !priceLines) return;

    const lines = priceLines.map((line) => series.createPriceLine(line));

    return () => {
      if (isChartRemoved(chart)) return;

      for (const line of lines) series.removePriceLine(line);
    };
  }, [chart, series, priceLines]);

  const marking = markers !== undefined;
  const markerPlugin = useRef<ISeriesMarkersPluginApi<Time> | null>(null);

  useLayoutEffect(() => {
    if (!series || !marking) return;

    const plugin = createSeriesMarkers(series);

    markerPlugin.current = plugin;

    return () => {
      markerPlugin.current = null;

      if (!isChartRemoved(chart)) plugin.detach();
    };
  }, [chart, series, marking]);

  useLayoutEffect(() => {
    if (markers) markerPlugin.current?.setMarkers(markers);
  }, [series, marking, markers]);

  const banding = bands !== undefined;
  const bandPrimitive = useRef<PriceBands | null>(null);

  useLayoutEffect(() => {
    if (!series || !banding) return;

    const primitive = new PriceBands();

    series.attachPrimitive(primitive);
    bandPrimitive.current = primitive;

    return () => {
      bandPrimitive.current = null;

      if (!isChartRemoved(chart)) series.detachPrimitive(primitive);
    };
  }, [chart, series, banding]);

  useLayoutEffect(() => {
    if (bands) bandPrimitive.current?.setBands(bands);
  }, [series, banding, bands]);

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
