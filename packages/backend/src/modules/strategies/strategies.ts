import { join } from "node:path";

import type { StrategyCatalog, StrategyReview } from "@solyx/api/strategies";
import { strategyBars } from "@solyx/core/backtest";
import type { BacktestOptions } from "@solyx/core/backtest";
import { Interval } from "@solyx/core/candles";
import type { Candle } from "@solyx/core/candles";
import type { SymbolRef } from "@solyx/core/market";
import {
  approvalAllows,
  lookAhead,
  strategyInput,
  strategyJobs,
  strategyParams,
} from "@solyx/core/strategy";
import type {
  LookAheadAt,
  StrategyApproval,
  StrategyApprover,
  StrategyParams,
  StrategyReach,
} from "@solyx/core/strategy";

import type { StrategyApprovals } from "./strategy-approvals.ts";
import {
  readStrategies,
  strategyFiles,
  strategyTexts,
} from "./strategy-folder.ts";
import type { Strategy } from "./strategy-folder.ts";
import type { StrategyRunner } from "./strategy-runner.ts";
import type { StrategySnapshots } from "./strategy-snapshots.ts";

export interface StrategiesOptions {
  /** `strategies/` in the config folder, read afresh every time. */
  folder: string;
  runner: StrategyRunner;
  approvals: StrategyApprovals;
  /** The files of the versions allowed, for showing what changed since. */
  snapshots: StrategySnapshots;
  /** Where strategies' code would run now. */
  reach(): StrategyReach;
  /** Each time a version is allowed or taken back. */
  onChange(): void;
  /** @default () => new Date() */
  now?: () => Date;
}

/** The approval among `approvals` that lets `strategy` run as it is now where `reach` says. */
const allowing = (
  approvals: readonly StrategyApproval[],
  strategy: Strategy,
  reach: StrategyReach
) =>
  approvals.find(
    (each) =>
      each.name === strategy.manifest.name &&
      each.version === strategy.version &&
      approvalAllows(each, reach)
  ) ?? null;

/** Why `strategy` may not run where `reach` says. */
function refusal(name: string, reach: StrategyReach) {
  if (reach.sandboxed) {
    return `${name} has not been allowed to run as its files are now`;
  }

  return reach.live
    ? `${name} has not been allowed to run as its files are now outside the sandbox beside a live account, which only the user allows, in one of the app's windows or answering a call`
    : `${name} has not been allowed to run as its files are now outside the sandbox`;
}

/**
 * The strategies the user writes in the config folder: what each is now, which of its versions may
 * run where, and the lines its code works out for a backtest, which the engine trades on.
 */
export function createStrategies(options: StrategiesOptions) {
  const now = options.now ?? (() => new Date());

  async function read() {
    const [{ strategies, problems }, approvals] = await Promise.all([
      readStrategies(options.folder),
      options.approvals.list(),
    ]);

    const reach = options.reach();

    return {
      strategies: strategies.map((strategy) => ({
        strategy,
        allowed: allowing(approvals, strategy, reach),
      })),
      reach,
      problems,
    };
  }

  /** The versions of `name` some approval still names. */
  const allowedVersions = async (name: string) =>
    new Set(
      (await options.approvals.list())
        .filter((each) => each.name === name)
        .map((each) => each.version)
    );

  async function find(name: string) {
    const { strategies, problems } = await readStrategies(options.folder);
    const strategy = strategies.find((each) => each.manifest.name === name);

    if (strategy) return strategy;

    const own = join(options.folder, name, "STRATEGY.md");
    const problem = problems.find((each) => each.startsWith(`${own}:`));

    throw new Error(problem ?? `No strategy is named ${name}`);
  }

  return {
    /** Every strategy as its folder is now, each with the approval that lets it run where it would. */
    read,

    /** What a window is told of the strategies. */
    async catalog(): Promise<StrategyCatalog> {
      const { strategies, reach, problems } = await read();

      return {
        strategies: strategies.map(({ strategy, allowed }) => ({
          ...strategy.manifest,
          notes: strategy.notes,
          version: strategy.version,
          files: strategyFiles(strategy),
          allowed,
        })),
        reach,
        problems,
      };
    },

    /**
     * Lets `version` of `name` run where its code would run now, as `by` allowed it: in the sandbox,
     * or outside it where it would run there. Refused once its files are no longer that version.
     */
    async approve(name: string, version: string, by: StrategyApprover) {
      const strategy = await find(name);

      if (strategy.version !== version) {
        throw new Error(
          `${name}'s files changed since that version; read them again before allowing it`
        );
      }

      const approval: StrategyApproval = {
        name,
        version,
        by,
        outside: !options.reach().sandboxed,
        at: now().getTime(),
      };

      await options.approvals.approve(approval);
      await options.snapshots.keep(strategy);
      await options.snapshots.keepOnly(name, await allowedVersions(name));
      options.onChange();

      return approval;
    },

    async revoke(name: string) {
      await options.approvals.revoke(name);
      await options.snapshots.keepOnly(name, new Set());
      options.onChange();
    },

    /** `name`'s files as they are now, beside those of the newest other version allowed. */
    async review(name: string): Promise<StrategyReview> {
      const strategy = await find(name);

      const before = (await options.approvals.list()).find(
        (each) => each.name === name && each.version !== strategy.version
      );

      return {
        name,
        current: { version: strategy.version, files: strategyTexts(strategy) },
        previous: before
          ? await options.snapshots.read(name, before.version)
          : null,
      };
    },

    /**
     * The lines `name`'s code works out over `candles` for each of `given`, its numbers filled in
     * from their initial values, for a backtest of the same bars, and where the code read bars after
     * one it worked a line out for. Refused unless the strategy as its files are now may run where it
     * would.
     */
    async lines(
      name: string,
      symbol: SymbolRef,
      candles: readonly Candle[],
      bars: Pick<BacktestOptions, "interval" | "daily">,
      given: readonly Readonly<StrategyParams>[],
      signal?: AbortSignal
    ) {
      const strategy = await find(name);
      const reach = options.reach();

      if (!allowing(await options.approvals.list(), strategy, reach)) {
        throw new Error(refusal(name, reach));
      }

      const params = given.map((each) =>
        strategyParams(strategy.manifest, each)
      );

      const adjusted = strategyBars(symbol, candles, bars);
      const { runs, cuts } = strategyJobs(params, adjusted.length);

      const input = strategyInput(
        symbol,
        bars.interval ?? Interval.OneDay,
        adjusted,
        [...runs, ...cuts]
      );

      const output = await options.runner.run(strategy, input, signal);
      const breach = lookAhead(output[0], output.slice(runs.length));

      return {
        rules: strategy.manifest.rules,
        params,
        lines: output.slice(0, runs.length),
        lookAhead:
          breach &&
          ({
            line: breach.line,
            time: input.bars.time[breach.bar],
          } satisfies LookAheadAt),
      };
    },
  };
}

export type Strategies = ReturnType<typeof createStrategies>;
