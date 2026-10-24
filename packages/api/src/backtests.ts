import * as z from "zod";

import { tradeCostsSchema } from "@solyx/core/backtest";
import {
  HISTORY_YEARS,
  historyYears,
  intervalSchema,
} from "@solyx/core/candles";
import type { Interval } from "@solyx/core/candles";
import { symbolRefSchema } from "@solyx/core/market";
import {
  gridAxisSchema,
  gridProblem,
  strategySetupSchema,
  templateSetupSchema,
} from "@solyx/core/strategy-templates";
import type { GridAxis, TemplateSetup } from "@solyx/core/strategy-templates";

/** What a window's backtest reads and trades: a listing's bars over its last years, from a capital and at costs. */
const reach = {
  symbol: symbolRefSchema,
  interval: intervalSchema,
  /** How many years of bars back from today it reads. */
  years: z.number().int().min(1).max(HISTORY_YEARS),
  /** @default 1_000_000 in the market's currency */
  capital: z.number().positive().optional(),
  costs: tradeCostsSchema.partial().optional(),
};

/** The share of the sessions before the out-of-sample stretch starts, such as 2/3. */
const splitSchema = z.number().gt(0).lt(1);

/** A grid of one template's numbers, one down and another across. */
const grid = {
  strategy: templateSetupSchema,
  rows: gridAxisSchema,
  columns: gridAxisSchema,
};

function withinHistory(
  { interval, years }: { interval: Interval; years: number },
  context: z.RefinementCtx
) {
  if (years > historyYears(interval)) {
    context.addIssue({
      code: "custom",
      path: ["years"],
      message: `${interval} bars reach ${historyYears(interval)} years back at most`,
    });
  }
}

function runsAsGrid(
  {
    strategy,
    rows,
    columns,
  }: { strategy: TemplateSetup; rows: GridAxis; columns: GridAxis },
  context: z.RefinementCtx
) {
  const problem = gridProblem(strategy, rows, columns);

  if (problem) {
    context.addIssue({
      code: "custom",
      path: ["rows"],
      message: `The grid does not run: ${problem}`,
    });
  }
}

/** A strategy run over a listing's last years, its record before and from the split apart. */
export const backtestSetupSchema = z
  .strictObject({ ...reach, strategy: strategySetupSchema, split: splitSchema })
  .superRefine(withinHistory);

export type BacktestSetup = z.infer<typeof backtestSetupSchema>;

/** Every setup of a grid run on its own, with the plateau of their Sharpe ratios in-sample. */
export const scanSetupSchema = z
  .strictObject({ ...reach, ...grid, split: splitSchema })
  .superRefine(withinHistory)
  .superRefine(runsAsGrid);

export type ScanSetup = z.infer<typeof scanSetupSchema>;

/** A grid picked from on each window's training and run on the sessions after. */
export const walkForwardSetupSchema = z
  .strictObject({
    ...reach,
    ...grid,
    /** Sessions each window trains on; @default two fifths of the sessions */
    train: z.number().int().positive().optional(),
    /** Sessions each window then tests on, and moves on by; @default a quarter of `train` */
    test: z.number().int().positive().optional(),
  })
  .superRefine(withinHistory)
  .superRefine(runsAsGrid);

export type WalkForwardSetup = z.infer<typeof walkForwardSetupSchema>;
