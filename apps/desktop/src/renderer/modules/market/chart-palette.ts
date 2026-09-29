import { Market } from "@solyx/core/market";

export interface ChartPalette {
  text: string;
  grid: string;
}

export const LIGHT_PALETTE: ChartPalette = {
  text: "#3f3f46",
  grid: "rgba(0, 0, 0, 0.06)",
};

export const DARK_PALETTE: ChartPalette = {
  text: "#d4d4d8",
  grid: "rgba(255, 255, 255, 0.07)",
};

export interface DirectionColors {
  rise: string;
  fall: string;
  riseVolume: string;
  fallVolume: string;
}

const RED = { solid: "rgb(229, 72, 77)", faded: "rgba(229, 72, 77, 0.45)" };

const GREEN = { solid: "rgb(48, 164, 108)", faded: "rgba(48, 164, 108, 0.45)" };

// Taiwan quotes rising prices in red and falling ones in green; US quotes do the opposite.
export const DIRECTION_COLORS: Record<Market, DirectionColors> = {
  [Market.TW]: {
    rise: RED.solid,
    fall: GREEN.solid,
    riseVolume: RED.faded,
    fallVolume: GREEN.faded,
  },
  [Market.US]: {
    rise: GREEN.solid,
    fall: RED.solid,
    riseVolume: GREEN.faded,
    fallVolume: RED.faded,
  },
};

export const LINE_COLORS = {
  ma5: "#f59e0b",
  ma10: "#3b82f6",
  ma20: "#a855f7",
  ma60: "#14b8a6",
  bollinger: "#94a3b8",
  fast: "#3b82f6",
  slow: "#f59e0b",
  oscillator: "#a855f7",
  level: "#a1a1aa",
};
