import { asyncIteratorObject, oc, type } from "@orpc/contract";

import { forDevices } from "./access.ts";

/** That what a module holds changed, without what changed: a window reads what it shows again. */
export type Change = Record<string, never>;

/** Yields a `Change` each time, by any window, the agent or a hand edit, until the window stops. */
export const changesContract = oc
  .meta(forDevices(true))
  .output(asyncIteratorObject(type<Change>()));
