import type { RanBacktest } from "@solyx/agent/wire";
import type { BacktestSetup } from "@solyx/api/backtests";
import { lookbackRange } from "@solyx/core/candles";
import { exchangeDate } from "@solyx/core/market";
import { dateEpochDay } from "@solyx/utils/date";

import { SPLITS } from "./backtest-form-values.ts";
import { yearChoices } from "./backtest-years.ts";

const DAYS_A_YEAR = 365.25;

const DEFAULT_SPLIT = 2 / 3;

/** The choice nearest `value`. */
const nearest = (choices: readonly number[], value: number) =>
  choices.reduce((best, each) =>
    Math.abs(each - value) < Math.abs(best - value) ? each : best
  );

/**
 * The panel's setup nearest a backtest the agent ran: its rules as written, and its span and split
 * as the nearest the panel offers, since the panel reads whole years back and splits by share.
 */
export function panelSetup(ran: RanBacktest, now = new Date()): BacktestSetup {
  const { symbol, interval } = ran;
  const today = dateEpochDay(exchangeDate(symbol.market, now));

  // Without a first day the agent read the app's own history.
  const since = dateEpochDay(
    ran.since ?? lookbackRange(symbol.market, interval, now).from
  );

  const span = Math.max(today - since, 1);

  const share =
    ran.split === undefined
      ? DEFAULT_SPLIT
      : "share" in ran.split
        ? ran.split.share
        : (dateEpochDay(ran.split.day) - since) / span;

  return {
    symbol,
    interval,
    years: nearest(yearChoices(interval), span / DAYS_A_YEAR),
    strategy: { rules: ran.strategy },
    split: nearest(SPLITS, share),
    capital: ran.capital,
    costs: ran.costs,
  };
}
