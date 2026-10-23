import * as z from "zod";
import { create } from "zustand";
import { persist } from "zustand/middleware";

import {
  ChartIndicator,
  chartIndicatorSchema,
} from "@solyx/api/chart-indicator";

import { persistOptions } from "../../app/persist.ts";

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
