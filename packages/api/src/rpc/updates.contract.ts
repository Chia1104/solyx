import { oc, type } from "@orpc/contract";

import type { UpdateState } from "../updates.ts";

import { forDevices } from "./access.ts";
import { changesContract } from "./changes.ts";

export const updatesContract = {
  state: oc.meta(forDevices(true)).output(type<UpdateState>()),
  /** Checks now, whether or not scheduled checks are on. */
  check: oc.output(type<void>()),
  /** Quits and installs the downloaded update, which restarts the app. */
  install: oc.output(type<void>()),
  /** A check or a download moved on, whoever started it. */
  changes: changesContract,
};
