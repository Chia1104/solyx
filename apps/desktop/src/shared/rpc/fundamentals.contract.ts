import { oc, type } from "@orpc/contract";

import { symbolRefSchema } from "@solyx/core/market";

import type { FinancialTrends } from "../fundamentals.ts";

export const fundamentalsContract = {
  /** `null` for a listing whose market no source covers; empty for one that files none, as a fund does. */
  trends: oc.input(symbolRefSchema).output(type<FinancialTrends | null>()),
};
