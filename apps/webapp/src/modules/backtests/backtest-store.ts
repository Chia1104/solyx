import { create } from "zustand";

import { BacktestMode } from "@solyx/api/backtests";
import type {
  BacktestRequest,
  BacktestSetup,
  ScanSetup,
  WalkForwardSetup,
} from "@solyx/api/backtests";
import { symbolKey } from "@solyx/core/market";
import type { SymbolRef } from "@solyx/core/market";

/** What the panel shows: a mode to run in, or the runs kept. */
export const PanelView = { ...BacktestMode, History: "history" } as const;

export type PanelView = (typeof PanelView)[keyof typeof PanelView];

/** What a listing's panel shows and ran last in each mode. */
export interface ListingBacktests {
  view: PanelView;
  run?: BacktestSetup;
  scan?: ScanSetup;
  walkForward?: WalkForwardSetup;
}

interface BacktestStore {
  /** By the listing's `symbolKey`, for the window's life. */
  listings: Partial<Record<string, ListingBacktests>>;
  setView(symbol: SymbolRef, view: PanelView): void;
  /** Runs a request in its mode, shown on its listing's panel. */
  ask(request: BacktestRequest): void;
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
          [key]: { view: PanelView.Run, ...state.listings[key], ...change },
        },
      };
    });

  return {
    listings: {},
    setView: (symbol, view) => update(symbol, { view }),
    ask: (request) =>
      update(request.setup.symbol, {
        view: request.mode,
        [request.mode]: request.setup,
      }),
    onChart: true,
    setOnChart: (onChart) => set({ onChart }),
  };
});
