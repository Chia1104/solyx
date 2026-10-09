const AMBER = "#f59e0b";

const BLUE = "#3b82f6";

const PURPLE = "#a855f7";

const ZINC = "#a1a1aa";

/** One per period of `MOVING_AVERAGE_PERIODS`, in its groups and order. */
export const MOVING_AVERAGE_COLORS = {
  short: [AMBER, BLUE, PURPLE],
  long: ["#14b8a6", "#d946ef", "#a8a29e"],
};

export const LINE_COLORS = {
  bollinger: "#94a3b8",
  fast: BLUE,
  slow: AMBER,
  oscillator: PURPLE,
  level: ZINC,
  volume: BLUE,
  surge: AMBER,
  lull: ZINC,
};
