import { oc, type } from "@orpc/contract";
import * as z from "zod";

import { memoryChangeSchema } from "@solyx/core/memory";
import type { Memory } from "@solyx/core/memory";

import { changesContract } from "./changes.ts";

export const memoryContract = {
  /** Most recently written first. */
  list: oc.output(type<Memory[]>()),
  /** Rewrites a memory's description and body; rejects once it is forgotten. */
  update: oc
    .input(z.object({ id: z.string(), change: memoryChangeSchema }))
    .output(type<Memory>()),
  forget: oc.input(z.string()).output(type<void>()),
  /** A memory was saved, rewritten or forgotten: by the agent, in any window or by clearing them. */
  changes: changesContract,
};
