import { create } from "zustand";

import type { BacktestSetup } from "@solyx/api/backtests";
import { symbolKey } from "@solyx/core/market";

interface BacktestStore {
  /** The setup each listing's panel ran last, by the listing's `symbolKey`. */
  runs: Partial<Record<string, BacktestSetup>>;
  run(setup: BacktestSetup): void;
  /** Whether a listing's chart marks the trades of the run its panel shows. */
  onChart: boolean;
  setOnChart(onChart: boolean): void;
}

export const useBacktestStore = create<BacktestStore>()((set) => ({
  runs: {},
  run: (setup) =>
    set((state) => ({
      runs: { ...state.runs, [symbolKey(setup.symbol)]: setup },
    })),
  onChart: true,
  setOnChart: (onChart) => set({ onChart }),
}));
