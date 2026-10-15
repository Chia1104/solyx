import { oc, type } from "@orpc/contract";
import * as z from "zod";

import { symbolRefSchema } from "@solyx/core/market";
import type { SymbolRef } from "@solyx/core/market";

import { changesContract } from "./changes.ts";

export const watchlistContract = {
  /** Watched listings in the user's order. */
  list: oc.output(type<SymbolRef[]>()),
  add: oc.input(symbolRefSchema).output(type<void>()),
  remove: oc.input(symbolRefSchema).output(type<void>()),
  /** Moves a watched listing to `index` among the others. */
  move: oc
    .input(
      z.object({
        symbol: symbolRefSchema,
        index: z.number().int().nonnegative(),
      })
    )
    .output(type<void>()),
  /** A listing was added, removed or moved, by any window or the agent, or all were cleared. */
  changes: changesContract,
};
