import { asyncIteratorObject, oc, type } from "@orpc/contract";
import * as z from "zod";

import { symbolRefSchema } from "@solyx/core/market";
import type { SymbolRef } from "@solyx/core/market";
import type { Headline, NewsReading } from "@solyx/core/news";

import type { NewsCoverage } from "../news.ts";

const daysSchema = z.number().int().min(1).max(90);

export const newsContract = {
  /** A listing's stories, gauge and daily stance over the last `days` days, grouped in the main process. */
  reading: oc
    .input(z.object({ symbol: symbolRefSchema, days: daysSchema }))
    .output(type<NewsReading>()),
  /** Where a listing's news comes from, so a quiet listing can be told from a broken source. */
  coverage: oc.input(symbolRefSchema).output(type<NewsCoverage>()),
  /** The `limit` heaviest headlines about the listings over the last `days` days. */
  headlines: oc
    .input(
      z.object({
        symbols: z.array(symbolRefSchema).max(500),
        days: daysSchema,
        limit: z.number().int().min(1).max(50),
      })
    )
    .output(type<Headline[]>()),
  /** Yields a listing whenever its news was collected, or some of it scored; source health may have changed with it. */
  changes: oc.output(asyncIteratorObject(type<SymbolRef>())),
};
