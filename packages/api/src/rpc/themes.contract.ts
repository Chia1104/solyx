import { oc, type } from "@orpc/contract";
import * as z from "zod";

import { themeDraftSchema } from "@solyx/core/theme";
import type { ThemeWatch } from "@solyx/core/theme";

import { forDevices } from "./access.ts";
import { changesContract } from "./changes.ts";

const idSchema = z.string().min(1);

export const themesContract = {
  /** Every theme with what watching it has found, the one with the newest development first. */
  list: oc.meta(forDevices(true)).output(type<ThemeWatch[]>()),
  create: oc.input(themeDraftSchema).output(type<void>()),
  /** Writes the theme again; what was found for it stays. */
  update: oc
    .input(z.object({ id: idSchema, draft: themeDraftSchema }))
    .output(type<void>()),
  /** Removes the theme with everything found and read for it. */
  remove: oc.input(idSchema).output(type<void>()),
  /** Searches for the theme now, whenever it was last searched. */
  check: oc.input(idSchema).output(type<void>()),
  /** A theme was written or removed, or a search found or read something for one. */
  changes: changesContract,
};
