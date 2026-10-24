import type {
  BacktestSetup,
  ScanSetup,
  WalkForwardSetup,
} from "@solyx/api/backtests";
import {
  backtest,
  backtestBars,
  scanBacktests,
  walkForward,
} from "@solyx/core/backtest";
import type { BacktestBarsSource, BacktestKernel } from "@solyx/core/backtest";
import { yearsBefore } from "@solyx/core/candles";
import type { Interval } from "@solyx/core/candles";
import type { SymbolRef } from "@solyx/core/market";
import {
  axisValues,
  gridSetups,
  setupRules,
} from "@solyx/core/strategy-templates";

export interface BacktestsOptions {
  /** Read through the candle cache, as the agent's backtests read them. */
  marketData: BacktestBarsSource;
  kernel: BacktestKernel;
  /** @default () => new Date() */
  now?: () => Date;
}

/** The backtests a window sets up: a template or rules over a listing's last years of bars. */
export function createBacktests({
  marketData,
  kernel,
  now = () => new Date(),
}: BacktestsOptions) {
  const listingBars = (symbol: SymbolRef, interval: Interval, years: number) =>
    backtestBars(
      marketData,
      symbol,
      interval,
      yearsBefore(symbol.market, years, now())
    );

  return {
    async run({
      symbol,
      interval,
      years,
      strategy,
      split,
      ...options
    }: BacktestSetup) {
      const { bars, daily } = await listingBars(symbol, interval, years);

      return backtest(kernel, symbol, bars, setupRules(strategy), {
        ...options,
        interval,
        daily,
        split: { share: split },
      });
    },

    async scan({
      symbol,
      interval,
      years,
      strategy,
      rows,
      columns,
      split,
      ...options
    }: ScanSetup) {
      const { bars, daily } = await listingBars(symbol, interval, years);

      return scanBacktests(
        kernel,
        symbol,
        bars,
        gridSetups(strategy, rows, columns).map(setupRules),
        {
          ...options,
          interval,
          daily,
          split: { share: split },
          columns: axisValues(columns).length,
        }
      );
    },

    async walkForward({
      symbol,
      interval,
      years,
      strategy,
      rows,
      columns,
      ...options
    }: WalkForwardSetup) {
      const { bars, daily } = await listingBars(symbol, interval, years);

      return walkForward(
        kernel,
        symbol,
        bars,
        gridSetups(strategy, rows, columns).map(setupRules),
        {
          ...options,
          interval,
          daily,
          columns: axisValues(columns).length,
        }
      );
    },
  };
}
