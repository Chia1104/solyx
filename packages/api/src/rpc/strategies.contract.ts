import { oc, type } from "@orpc/contract";

import { saveStrategyArgumentsSchema } from "@solyx/agent/wire";
import { strategyNameSchema } from "@solyx/core/strategy";
import type { StrategyApproval, StrategyRuntime } from "@solyx/core/strategy";

import { strategyApproveSchema } from "../strategies.ts";
import type { StrategyCatalog, StrategyReview } from "../strategies.ts";

import { forDevices } from "./access.ts";
import { changesContract } from "./changes.ts";

export const strategiesContract = {
  /** The strategies in the config folder as they are now, each with whether it may run. */
  list: oc.meta(forDevices(true)).output(type<StrategyCatalog>()),
  /**
   * Lets the version named run where the strategy would run now, as the user's own choice; a
   * device may not, since it lets the code run.
   */
  approve: oc.input(strategyApproveSchema).output(type<StrategyApproval>()),
  /**
   * A strategy's files as they are now beside the version allowed before them, which a window shows
   * as what changed before the user allows it.
   */
  review: oc.input(strategyNameSchema).output(type<StrategyReview>()),
  /**
   * What the agent's call to save a strategy would make of its files beside the newest version
   * allowed, which a window shows before the user allows the call; refused as the call would be.
   */
  draft: oc.input(saveStrategyArgumentsSchema).output(type<StrategyReview>()),
  /** Takes back every version of a strategy allowed so far. */
  revoke: oc.input(strategyNameSchema).output(type<void>()),
  /**
   * Moves a strategy's folder to the computer's trash, where the user can take it back, and takes
   * back every version allowed; a folder that holds no strategy that reads goes too.
   */
  trash: oc.input(strategyNameSchema).output(type<void>()),
  /** Shows a strategy's folder in the file manager, or the strategies folder, made first, for `null`. */
  reveal: oc.input(strategyNameSchema.nullable()).output(type<void>()),
  /** The interpreters a strategy's code finds where it would run now, each with its version. */
  runtimes: oc.output(type<StrategyRuntime[]>()),
  /** Each time a strategy is written, or a version allowed or taken back. */
  changes: changesContract,
};
