import { randomUUID } from "node:crypto";

import {
  BACKTEST_HISTORY,
  BacktestMode,
  backtestRequestSchema,
} from "@solyx/api/backtests";
import type {
  BacktestRecord,
  BacktestRequest,
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
import type {
  BacktestBarsSource,
  BacktestKernel,
  BacktestMetrics,
} from "@solyx/core/backtest";
import { yearsBefore } from "@solyx/core/candles";
import type { Interval } from "@solyx/core/candles";
import type { SymbolRef } from "@solyx/core/market";
import {
  axisValues,
  gridSetups,
  setupRules,
} from "@solyx/core/strategy-templates";
import type { BacktestRunStore } from "@solyx/db/user";

export interface BacktestsOptions {
  /** Read through the candle cache, as the agent's backtests read them. */
  marketData: BacktestBarsSource;
  kernel: BacktestKernel;
  /** Where the windows' runs are kept. */
  history: BacktestRunStore;
  /** Each time a run is kept, removed or cleared. */
  onHistoryChange(): void;
  /** @default () => new Date() */
  now?: () => Date;
}

/**
 * The backtests a window sets up: a template or rules over a listing's last years of bars. Each
 * one it asks for is kept in the history, its request with how it did; one asked for again only
 * updates its row.
 */
export function createBacktests({
  marketData,
  kernel,
  history,
  onHistoryChange,
  now = () => new Date(),
}: BacktestsOptions) {
  const listingBars = (symbol: SymbolRef, interval: Interval, years: number) =>
    backtestBars(
      marketData,
      symbol,
      interval,
      yearsBefore(symbol.market, years, now())
    );

  function keep(request: BacktestRequest, headline: BacktestMetrics | null) {
    history.record(
      JSON.stringify(request),
      { id: randomUUID(), ranAt: now().getTime(), request, headline },
      BACKTEST_HISTORY
    );
    onHistoryChange();
  }

  async function runOnce({
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
  }

  /** The runs kept, newest first, leaving out any whose request no longer reads. */
  function records(): BacktestRecord[] {
    return history.list().flatMap(({ request, ...run }) => {
      const parsed = backtestRequestSchema.safeParse(request);

      return parsed.success ? [{ ...run, request: parsed.data }] : [];
    });
  }

  return {
    async run(setup: BacktestSetup) {
      const result = await runOnce(setup);

      keep({ mode: BacktestMode.Run, setup }, result.outOfSample ?? result.all);

      return result;
    },

    async scan(setup: ScanSetup) {
      const {
        symbol,
        interval,
        years,
        strategy,
        rows,
        columns,
        split,
        ...options
      } = setup;

      const { bars, daily } = await listingBars(symbol, interval, years);

      const scan = await scanBacktests(
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

      const plateau = scan.plateau ? scan.cells[scan.plateau.cell] : null;

      keep(
        { mode: BacktestMode.Scan, setup },
        plateau ? (plateau.inSample ?? plateau.all) : null
      );

      return scan;
    },

    async walkForward(setup: WalkForwardSetup) {
      const { symbol, interval, years, strategy, rows, columns, ...options } =
        setup;

      const { bars, daily } = await listingBars(symbol, interval, years);

      const walked = await walkForward(
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

      keep({ mode: BacktestMode.WalkForward, setup }, walked.outOfSample);

      return walked;
    },

    history: records,

    remove(id: string) {
      history.remove(id);
      onHistoryChange();
    },

    clear() {
      history.clear();
      onHistoryChange();
    },

    /**
     * Runs the single backtests kept under `ids` again, over the bars as they are now, so they read
     * side by side; comparing keeps nothing.
     */
    compare(ids: string[]) {
      const kept = records();

      return Promise.all(
        ids.map(async (id) => {
          const record = kept.find((each) => each.id === id);

          if (record?.request.mode !== BacktestMode.Run) {
            throw new Error(`No single backtest is kept as ${id}`);
          }

          return { id, result: await runOnce(record.request.setup) };
        })
      );
    },
  };
}
