import { oc, type } from "@orpc/contract";
import * as z from "zod";

import { symbolRefSchema } from "@solyx/core/market";
import { TwSector } from "@solyx/core/sectors";
import type { SectorMovers } from "@solyx/core/sectors";

import type { FinancialTrends } from "../fundamentals.ts";

import { forDevices } from "./access.ts";

export const fundamentalsContract = {
  /** `null` for a listing whose market no source covers; empty for one that files none, as a fund does. */
  trends: oc
    .meta(forDevices(true))
    .input(symbolRefSchema)
    .output(type<FinancialTrends | null>()),
  /** `null` while no source lists the sector's companies. */
  sectorMovers: oc
    .meta(forDevices(true))
    .input(z.enum(TwSector))
    .output(type<SectorMovers | null>()),
};
