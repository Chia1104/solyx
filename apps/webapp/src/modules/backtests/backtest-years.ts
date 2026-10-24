import {
  HISTORY_YEARS,
  INTRADAY_HISTORY_YEARS,
  isIntraday,
} from "@solyx/core/candles";
import type { Interval } from "@solyx/core/candles";

const INTRADAY_YEARS = Array.from(
  { length: INTRADAY_HISTORY_YEARS },
  (_, index) => index + 1
);

const DAILY_YEARS = [1, 3, 5, HISTORY_YEARS];

/** The years a run may read back, as far as its interval's history reaches. */
export const yearChoices = (interval: Interval) =>
  isIntraday(interval) ? INTRADAY_YEARS : DAILY_YEARS;
