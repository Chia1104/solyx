import { Market } from "@solyx/core/market";

interface ChartPalette {
  text: string;
  grid: string;
}

// The canvas cannot read CSS variables, so these follow --muted and --separator in styles.css.
export const LIGHT_PALETTE: ChartPalette = {
  text: "#646c7b",
  grid: "#dce0e7",
};

export const DARK_PALETTE: ChartPalette = {
  text: "#8a94a6",
  grid: "#232c3a",
};

interface PriceColor {
  solid: string;
  faded: string;
  /** The class for quote text, which takes the --quote-* pair in styles.css rather than these. */
  text: string;
}

const RED: PriceColor = {
  solid: "rgb(229, 72, 77)",
  faded: "rgba(229, 72, 77, 0.45)",
  text: "text-quote-red",
};

const GREEN: PriceColor = {
  solid: "rgb(48, 164, 108)",
  faded: "rgba(48, 164, 108, 0.45)",
  text: "text-quote-green",
};

export interface DirectionColors {
  rise: PriceColor;
  fall: PriceColor;
}

// Taiwan quotes rising prices in red and falling ones in green; US quotes do the opposite.
export const DIRECTION_COLORS: Record<Market, DirectionColors> = {
  [Market.TW]: { rise: RED, fall: GREEN },
  [Market.US]: { rise: GREEN, fall: RED },
};

const AMBER = "#f59e0b";

const BLUE = "#3b82f6";

const PURPLE = "#a855f7";

export const LINE_COLORS = {
  ma5: AMBER,
  ma10: BLUE,
  ma20: PURPLE,
  ma60: "#14b8a6",
  bollinger: "#94a3b8",
  fast: BLUE,
  slow: AMBER,
  oscillator: PURPLE,
  level: "#a1a1aa",
};
