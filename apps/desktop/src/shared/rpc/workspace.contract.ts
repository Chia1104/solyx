import { oc, type } from "@orpc/contract";

import type { Destination } from "../workspace.ts";

import { changesContract } from "./changes.ts";

export const workspaceContract = {
  /** The place the main process last asked for, handed over once; `null` when none waits. */
  takeDestination: oc.output(type<Destination | null>()),
  /** The main process asked for a place, which `takeDestination` hands over. */
  changes: changesContract,
};
