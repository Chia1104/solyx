import { oc, type } from "@orpc/contract";

import { strategyNameSchema } from "@solyx/core/strategy";

import { strategyApproveSchema } from "../strategies.ts";
import type { StrategyApproval, StrategyCatalog } from "../strategies.ts";

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
  /** Takes back every version of a strategy allowed so far. */
  revoke: oc.input(strategyNameSchema).output(type<void>()),
  /** Each time a version is allowed or taken back. */
  changes: changesContract,
};
