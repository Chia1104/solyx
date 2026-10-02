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
} as const;

export type ChartIndicator =
  (typeof ChartIndicator)[keyof typeof ChartIndicator];

const chartIndicatorSchema = z.enum(ChartIndicator);

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
