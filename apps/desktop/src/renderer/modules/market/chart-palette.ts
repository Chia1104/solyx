const AMBER = "#f59e0b";

const BLUE = "#3b82f6";

const CYAN = "#06b6d4";

const FUCHSIA = "#d946ef";

const SLATE = "#94a3b8";

const PURPLE = "#a855f7";

const ZINC = "#a1a1aa";

/** One per period of `MOVING_AVERAGE_PERIODS`, in its groups and order. */
export const MOVING_AVERAGE_COLORS = {
  short: [AMBER, BLUE, PURPLE],
  long: ["#14b8a6", FUCHSIA, "#a8a29e"],
};

export const LINE_COLORS = {
  bollinger: SLATE,
  fast: BLUE,
  slow: AMBER,
  oscillator: PURPLE,
  level: ZINC,
  volume: BLUE,
  surge: AMBER,
  lull: ZINC,
  /** A volume profile's busiest slice and the densest trading under the close. */
  control: AMBER,
  vwap: CYAN,
  /** Who traded a listing beside foreigners and trusts, which take `fast` and `slow`. */
  dealer: CYAN,
  short: FUCHSIA,
  holding: SLATE,
};

/** A six-digit hex colour, as palettes and these constants are, at an opacity from 0 to 1. */
export const faded = (color: string, opacity: number) =>
  `${color}${Math.round(opacity * 255)
    .toString(16)
    .padStart(2, "0")}`;
