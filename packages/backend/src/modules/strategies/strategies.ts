import { mkdir, stat } from "node:fs/promises";
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
  StrategyChange,
  StrategyParams,
  StrategyReach,
} from "@solyx/core/strategy";

import type { StrategyApprovals } from "./strategy-approvals.ts";
import {
  draftStrategy,
  readStrategies,
  strategyFiles,
  strategyTexts,
  writeStrategyChange,
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
  /** Shows a file or folder in the file manager. */
  showItemInFolder(path: string): void;
  /** Moves a file or folder to the computer's trash. */
  trashItem(path: string): Promise<void>;
  /** Each time a strategy is written, or a version allowed or taken back. */
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
        approvals: approvals.filter(
          (each) => each.name === strategy.manifest.name
        ),
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

  /**
   * What `name`'s folder holds now and would hold once `change` is made to the version `basedOn`,
   * `undefined` for a strategy not yet written. A change to files that have left that version is
   * refused, so it never writes over what its writer did not read; one that leaves them as they
   * are is not, as when it was made already.
   */
  async function draft(
    name: string,
    basedOn: string | undefined,
    change: StrategyChange
  ) {
    const drafted = await draftStrategy(options.folder, name, change);
    const { current } = drafted;

    if (current === null && basedOn !== undefined) {
      throw new Error(
        `No strategy is named ${name}; leave the version out to write a new one`
      );
    }

    if (
      current !== null &&
      drafted.draft.version !== current.version &&
      basedOn !== current.version
    ) {
      throw new Error(
        basedOn === undefined
          ? `${name} is a strategy already; read it and pass the version read to change it, or write a new one under another name`
          : `${name}'s files changed since that version; read them again before changing them`
      );
    }

    return drafted;
  }

  return {
    /** Every strategy as its folder is now, each with the approval that lets it run where it would. */
    read,

    /** What a window is told of the strategies. */
    async catalog(): Promise<StrategyCatalog> {
      const { strategies, reach, problems } = await read();

      return {
        strategies: strategies.map(({ strategy, allowed, approvals }) => ({
          ...strategy.manifest,
          notes: strategy.notes,
          version: strategy.version,
          files: strategyFiles(strategy),
          allowed,
          approvals,
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

    draft,

    /**
     * What `change` would make of `name`'s files beside the newest version allowed, the files as
     * they are now where those are one, so the user allowing the change reads all it would let run.
     */
    async reviewDraft(
      name: string,
      basedOn: string | undefined,
      change: StrategyChange
    ): Promise<StrategyReview> {
      const { current, draft: drafted } = await draft(name, basedOn, change);

      const approvals = (await options.approvals.list()).filter(
        (each) => each.name === name
      );

      const newest = approvals.at(0);

      const previous =
        current && approvals.some((each) => each.version === current.version)
          ? { version: current.version, files: strategyTexts(current) }
          : newest
            ? await options.snapshots.read(name, newest.version)
            : null;

      return {
        name,
        current: { version: drafted.version, files: strategyTexts(drafted) },
        previous,
      };
    },

    /**
     * Makes `change` to the version `basedOn` of `name`'s files, as `draft` checks it, and gives the
     * version they then are. Refused where something else changed them as they were written.
     */
    async save(
      name: string,
      basedOn: string | undefined,
      change: StrategyChange
    ) {
      const { current, draft: drafted } = await draft(name, basedOn, change);

      if (drafted.version === current?.version) return drafted.version;

      const written = await writeStrategyChange(options.folder, name, change);

      options.onChange();

      if (written.version !== drafted.version) {
        throw new Error(
          `${name}'s files changed as they were written; read them again`
        );
      }

      return written.version;
    },

    /** The interpreters a strategy's code finds where it would run now, with their versions. */
    runtimes: (signal?: AbortSignal) => options.runner.probe(signal),

    async revoke(name: string) {
      await options.approvals.revoke(name);
      await options.snapshots.keepOnly(name, new Set());
      options.onChange();
    },

    /**
     * Moves `name`'s folder to the computer's trash, whether or not it reads as a strategy, and
     * takes back every version allowed, so one put back from the trash asks again before it runs.
     */
    async trash(name: string) {
      const folder = join(options.folder, name);

      if (!(await stat(folder)).isDirectory()) {
        throw new Error(`${name} in the strategies folder is not a folder`);
      }

      await options.trashItem(folder);
      await options.approvals.revoke(name);
      await options.snapshots.keepOnly(name, new Set());
      options.onChange();
    },

    /** Shows `name`'s folder in the file manager, or the strategies folder, made first, for `null`. */
    async reveal(name: string | null) {
      if (name === null) {
        await mkdir(options.folder, { recursive: true });
        options.showItemInFolder(options.folder);

        return;
      }

      // A strategy found is a folder there, so a name never shows what lies elsewhere.
      await find(name);
      options.showItemInFolder(join(options.folder, name));
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
