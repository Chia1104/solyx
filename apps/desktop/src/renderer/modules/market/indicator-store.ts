import * as z from "zod";
import { create } from "zustand";
import { persist } from "zustand/middleware";

export const ChartIndicator = {
  MovingAverage: "ma",
  Bollinger: "boll",
  Macd: "macd",
  Rsi: "rsi",
  Kd: "kd",
} as const;

export type ChartIndicator =
  (typeof ChartIndicator)[keyof typeof ChartIndicator];

export const chartIndicatorSchema = z.enum(ChartIndicator);

interface IndicatorState {
  enabled: ChartIndicator[];
}

interface IndicatorActions {
  setEnabled: (enabled: ChartIndicator[]) => void;
}

export type IndicatorStore = IndicatorState & IndicatorActions;

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
    {
      name: "solyx.chart-indicators",
      version: 1,
      // Local storage outlives app versions, so anything that no longer parses is dropped.
      merge: (persisted, current) => ({
        ...current,
        ...persistedIndicatorsSchema.safeParse(persisted).data,
      }),
    }
  )
);
