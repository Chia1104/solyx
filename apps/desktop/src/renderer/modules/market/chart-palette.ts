const AMBER = "#f59e0b";

const BLUE = "#3b82f6";

const PURPLE = "#a855f7";

/** One per period of `MOVING_AVERAGE_PERIODS`, in its order. */
export const MOVING_AVERAGE_COLORS: readonly string[] = [
  AMBER,
  BLUE,
  PURPLE,
  "#14b8a6",
];

export const LINE_COLORS = {
  bollinger: "#94a3b8",
  fast: BLUE,
  slow: AMBER,
  oscillator: PURPLE,
  level: "#a1a1aa",
};
