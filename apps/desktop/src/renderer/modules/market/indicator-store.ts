import * as z from "zod";
import { create } from "zustand";
import { persist } from "zustand/middleware";

import { persistOptions } from "../../app/persist.ts";

export const ChartIndicator = {
  MovingAverage: "ma",
  Bollinger: "boll",
  Macd: "macd",
  Rsi: "rsi",
  Kd: "kd",
  ForeignFlow: "foreign-flow",
  TrustFlow: "trust-flow",
  Margin: "margin",
} as const;

export type ChartIndicator =
  (typeof ChartIndicator)[keyof typeof ChartIndicator];

const chartIndicatorSchema = z.enum(ChartIndicator);

/** Drawn from who traded a listing, which only Taiwan's exchanges report. */
export const FLOW_INDICATORS: readonly ChartIndicator[] = [
  ChartIndicator.ForeignFlow,
  ChartIndicator.TrustFlow,
  ChartIndicator.Margin,
];

interface IndicatorState {
  enabled: ChartIndicator[];
}

interface IndicatorActions {
  setEnabled: (enabled: ChartIndicator[]) => void;
}

type IndicatorStore = IndicatorState & IndicatorActions;

const defaultState: IndicatorState = {
  enabled: [ChartIndicator.MovingAverage, ChartIndicator.Kd],
};

const persistedIndicatorsSchema = z.object({
  enabled: z.array(chartIndicatorSchema),
});

export const useIndicatorStore = create<IndicatorStore>()(
  persist(
    (set) => ({
      ...defaultState,
      setEnabled: (enabled) => set({ enabled }),
    }),
    persistOptions<IndicatorStore>(
      "chart-indicators",
      persistedIndicatorsSchema
    )
  )
);
