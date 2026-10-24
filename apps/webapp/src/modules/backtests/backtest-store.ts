import { create } from "zustand";

import type {
  BacktestSetup,
  ScanSetup,
  WalkForwardSetup,
} from "@solyx/api/backtests";
import { symbolKey } from "@solyx/core/market";
import type { SymbolRef } from "@solyx/core/market";

/** What the panel runs: one setup, a grid of them, or a grid picked from as it walks forward. */
export const BacktestMode = {
  Run: "run",
  Scan: "scan",
  WalkForward: "walkForward",
} as const;

export type BacktestMode = (typeof BacktestMode)[keyof typeof BacktestMode];

/** What a listing's panel shows and ran last in each mode. */
export interface ListingBacktests {
  mode: BacktestMode;
  run?: BacktestSetup;
  scan?: ScanSetup;
  walkForward?: WalkForwardSetup;
}

interface BacktestStore {
  /** By the listing's `symbolKey`, for the window's life. */
  listings: Partial<Record<string, ListingBacktests>>;
  setMode(symbol: SymbolRef, mode: BacktestMode): void;
  run(setup: BacktestSetup): void;
  scan(setup: ScanSetup): void;
  walkForward(setup: WalkForwardSetup): void;
  /** Whether a listing's chart marks the trades of the run its panel shows. */
  onChart: boolean;
  setOnChart(onChart: boolean): void;
}

export const useBacktestStore = create<BacktestStore>()((set) => {
  const update = (symbol: SymbolRef, change: Partial<ListingBacktests>) =>
    set((state) => {
      const key = symbolKey(symbol);

      return {
        listings: {
          ...state.listings,
          [key]: {
            mode: BacktestMode.Run,
            ...state.listings[key],
            ...change,
          },
        },
      };
    });

  return {
    listings: {},
    setMode: (symbol, mode) => update(symbol, { mode }),
    // Running one shows it, so a scan's cell run alone opens on its run.
    run: (setup) =>
      update(setup.symbol, { mode: BacktestMode.Run, run: setup }),
    scan: (setup) => update(setup.symbol, { scan: setup }),
    walkForward: (setup) => update(setup.symbol, { walkForward: setup }),
    onChart: true,
    setOnChart: (onChart) => set({ onChart }),
  };
});
