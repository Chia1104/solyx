import {
  createContext,
  use,
  useEffectEvent,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { CSSProperties, ReactNode, Ref } from "react";

import { createChart } from "lightweight-charts";
import type {
  ChartOptions,
  DeepPartial,
  IChartApi,
  LogicalRange,
} from "lightweight-charts";

const ChartContext = createContext<IChartApi | null>(null);

const removedCharts = new WeakSet<IChartApi>();

/**
 * Whether `<Chart>` has already removed this chart along with its series.
 * React runs a parent's unmount cleanup before its children's, so child cleanups must check it.
 */
export function isChartRemoved(chart: IChartApi): boolean {
  return removedCharts.has(chart);
}

export function useChart(): IChartApi {
  const chart = use(ChartContext);

  if (!chart) throw new Error("useChart must be called inside <Chart>");

  return chart;
}

export interface ChartProps {
  options?: DeepPartial<ChartOptions>;
  /** Styles the positioned wrapper; give it a height, the chart fills it. */
  className?: string;
  /** Series and overlays; overlays can position against the wrapper. */
  children?: ReactNode;
  /**
   * The bars in view, by index into the data, as the user scrolls or zooms or the data changes;
   * a `from` near 0 means the oldest bar is close.
   */
  onVisibleLogicalRangeChange?: (range: LogicalRange | null) => void;
  ref?: Ref<IChartApi | null>;
}

const wrapperStyle: CSSProperties = { position: "relative" };

const canvasStyle: CSSProperties = { position: "absolute", inset: 0 };

/** Owns one lightweight-charts instance; children render once it exists. */
export function Chart({
  options,
  className,
  children,
  onVisibleLogicalRangeChange,
  ref,
}: ChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [chart, setChart] = useState<IChartApi | null>(null);

  useLayoutEffect(() => {
    const container = containerRef.current;

    if (!container) return;

    const instance = createChart(container, { autoSize: true });

    setChart(instance);

    return () => {
      setChart(null);
      removedCharts.add(instance);
      instance.remove();
    };
  }, []);

  useLayoutEffect(() => {
    if (chart && options) chart.applyOptions(options);
  }, [chart, options]);

  const rangeChanged = useEffectEvent((range: LogicalRange | null) =>
    onVisibleLogicalRangeChange?.(range)
  );

  useLayoutEffect(() => {
    if (!chart) return;

    const timeScale = chart.timeScale();
    const listener = (range: LogicalRange | null) => rangeChanged(range);

    timeScale.subscribeVisibleLogicalRangeChange(listener);

    return () => {
      if (!isChartRemoved(chart)) {
        timeScale.unsubscribeVisibleLogicalRangeChange(listener);
      }
    };
  }, [chart]);

  useImperativeHandle<IChartApi | null, IChartApi | null>(ref, () => chart, [
    chart,
  ]);

  return (
    <div className={className} style={wrapperStyle}>
      <div ref={containerRef} style={canvasStyle} />
      {chart && <ChartContext value={chart}>{children}</ChartContext>}
    </div>
  );
}
