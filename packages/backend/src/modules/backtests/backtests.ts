import { randomUUID } from "node:crypto";

import {
  BACKTEST_HISTORY,
  BacktestMode,
  backtestRequestSchema,
  gridCellSetups,
} from "@solyx/api/backtests";
import type {
  BacktestHeadline,
  BacktestRecord,
  BacktestRequest,
  BacktestSetup,
  OwnSetup,
  RollingSetup,
  ScanSetup,
  WalkForwardSetup,
} from "@solyx/api/backtests";
import {
  backtest,
  backtestBars,
  rollingBacktest,
  scanBacktests,
  walkForward,
} from "@solyx/core/backtest";
import type {
  BacktestBarsSource,
  BacktestKernel,
  BacktestOptions,
  RuleStrategy,
  StrategyLines,
} from "@solyx/core/backtest";
import { yearsBefore } from "@solyx/core/candles";
import type { Candle, Interval } from "@solyx/core/candles";
import type { SymbolRef } from "@solyx/core/market";
import type { LookAheadAt } from "@solyx/core/strategy";
import { axisValues, setupRules } from "@solyx/core/strategy-templates";
import type { StrategySetup } from "@solyx/core/strategy-templates";
import type { BacktestRunStore } from "@solyx/db/user";

import type { Strategies } from "../strategies/strategies.ts";

export interface BacktestsOptions {
  /** A listing's bars through the candle cache and its distributions through the fundamentals module, as the agent's backtests read them. */
  marketData: BacktestBarsSource;
  kernel: BacktestKernel;
  /** Where the windows' runs are kept. */
  history: BacktestRunStore;
  /** The user's strategies, whose code works out the lines their rules read. */
  strategies: Pick<Strategies, "lines">;
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
  strategies,
  onHistoryChange,
  now = () => new Date(),
}: BacktestsOptions) {
  const listingBars = (
    symbol: SymbolRef,
    interval: Interval,
    years: number,
    costs: BacktestOptions["costs"]
  ) =>
    backtestBars(
      marketData,
      symbol,
      interval,
      yearsBefore(symbol.market, years, now()),
      costs
    );

  function keep(request: BacktestRequest, headline: BacktestHeadline | null) {
    history.record(
      JSON.stringify(request),
      { id: randomUUID(), ranAt: now().getTime(), request, headline },
      BACKTEST_HISTORY
    );
    onHistoryChange();
  }

  /**
   * What each of a run's strategies trades on: its rules, and where a strategy the user wrote runs
   * them, the lines its code worked out for each set of `params`, with where it read later bars.
   */
  async function ruled(
    { symbol, interval }: { symbol: SymbolRef; interval: Interval },
    read: { bars: Candle[]; daily: Candle[] | undefined },
    strategy: StrategySetup | OwnSetup,
    params: OwnSetup["params"][]
  ): Promise<{
    rules: RuleStrategy[];
    lines: StrategyLines[] | undefined;
    lookAhead: LookAheadAt | null;
  }> {
    if (!("name" in strategy)) {
      return {
        rules: [setupRules(strategy)],
        lines: undefined,
        lookAhead: null,
      };
    }

    const worked = await strategies.lines(
      strategy.name,
      symbol,
      read.bars,
      { interval, daily: read.daily },
      params
    );

    return {
      rules: worked.params.map(() => worked.rules),
      lines: worked.lines,
      lookAhead: worked.lookAhead,
    };
  }

  /** A grid's rules and lines over `read`, its cells row by row. */
  async function gridRules(
    setup: ScanSetup | WalkForwardSetup,
    read: { bars: Candle[]; daily: Candle[] | undefined }
  ) {
    const cells = gridCellSetups(setup.strategy, setup.rows, setup.columns);

    if ("template" in setup.strategy) {
      return {
        rules: cells.flatMap((cell) =>
          "template" in cell ? [setupRules(cell)] : []
        ),
        lines: undefined,
        lookAhead: null,
      };
    }

    return ruled(
      setup,
      read,
      setup.strategy,
      cells.map((cell) => cell.params)
    );
  }

  async function runOnce({
    symbol,
    interval,
    years,
    strategy,
    split,
    ...options
  }: BacktestSetup) {
    const read = await listingBars(symbol, interval, years, options.costs);

    const { rules, lines, lookAhead } = await ruled(
      { symbol, interval },
      read,
      strategy,
      ["name" in strategy ? strategy.params : {}]
    );

    const run: BacktestOptions = {
      ...options,
      interval,
      daily: read.daily,
      dividends: read.dividends,
      split: { share: split },
      lines: lines?.[0],
    };

    return {
      ...(await backtest(kernel, symbol, read.bars, rules[0], run)),
      lookAhead,
    };
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
      const { symbol, interval, years, capital, costs, columns, split } = setup;
      const read = await listingBars(symbol, interval, years, costs);
      const grid = await gridRules(setup, read);

      const scan = await scanBacktests(kernel, symbol, read.bars, grid.rules, {
        capital,
        costs,
        interval,
        daily: read.daily,
        dividends: read.dividends,
        split: { share: split },
        columns: axisValues(columns).length,
        lines: grid.lines,
      });

      const plateau = scan.plateau ? scan.cells[scan.plateau.cell] : null;

      keep(
        { mode: BacktestMode.Scan, setup },
        plateau ? (plateau.inSample ?? plateau.all) : null
      );

      return { ...scan, lookAhead: grid.lookAhead };
    },

    async walkForward(setup: WalkForwardSetup) {
      const { symbol, interval, years, capital, costs, columns, train, test } =
        setup;

      const read = await listingBars(symbol, interval, years, costs);
      const grid = await gridRules(setup, read);

      const walked = await walkForward(kernel, symbol, read.bars, grid.rules, {
        capital,
        costs,
        train,
        test,
        interval,
        daily: read.daily,
        dividends: read.dividends,
        columns: axisValues(columns).length,
        lines: grid.lines,
      });

      keep({ mode: BacktestMode.WalkForward, setup }, walked.outOfSample);

      return { ...walked, lookAhead: grid.lookAhead };
    },

    async rolling(setup: RollingSetup) {
      const { symbol, interval, years, strategy, ...options } = setup;
      const read = await listingBars(symbol, interval, years, options.costs);

      const { rules, lines, lookAhead } = await ruled(setup, read, strategy, [
        "name" in strategy ? strategy.params : {},
      ]);

      const rolled = await rollingBacktest(
        kernel,
        symbol,
        read.bars,
        rules[0],
        {
          ...options,
          interval,
          daily: read.daily,
          dividends: read.dividends,
          lines: lines?.[0],
        }
      );

      keep({ mode: BacktestMode.Rolling, setup }, rolled.summary);

      return { ...rolled, lookAhead };
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
