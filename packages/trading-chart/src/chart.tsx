import {
  createContext,
  use,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { CSSProperties, ReactNode, Ref } from "react";

import { createChart } from "lightweight-charts";
import type { ChartOptions, DeepPartial, IChartApi } from "lightweight-charts";

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
  ref?: Ref<IChartApi | null>;
}

const wrapperStyle: CSSProperties = { position: "relative" };

const canvasStyle: CSSProperties = { position: "absolute", inset: 0 };

/** Owns one lightweight-charts instance; children render once it exists. */
export function Chart({ options, className, children, ref }: ChartProps) {
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
