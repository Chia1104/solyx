import * as z from "zod";

import { errorMessage } from "@solyx/utils/error";

import { lineNameSchema, ruleStrategySchema } from "./backtest.ts";
import type { StrategyLines } from "./backtest.ts";
import { barTime } from "./candles.ts";
import type { Candle, Interval } from "./candles.ts";
import type { SymbolRef } from "./market.ts";
import { takesValue } from "./strategy-templates.ts";
import type { TemplateParam } from "./strategy-templates.ts";

/** What a strategy's folder, and the name its `STRATEGY.md` gives, is called. */
export const strategyNameSchema = z
  .string()
  .max(64)
  .regex(
    /^[a-z0-9]+(-[a-z0-9]+)*$/,
    "A strategy's name is up to 64 lowercase letters, digits and single hyphens"
  );

const paramNameSchema = z
  .string()
  .regex(
    /^[A-Za-z_][A-Za-z0-9_]{0,63}$/,
    "A number's name is a letter or an underscore, then up to 63 letters, digits and underscores"
  );

/** The most numbers a strategy takes. */
export const MAX_STRATEGY_PARAMS = 8;

/** A number a strategy's code takes, from `min` to `max` in steps of `step`, as a template's are. */
export const strategyParamSchema = z
  .strictObject({
    min: z.number(),
    max: z.number(),
    step: z.number().positive(),
    initial: z.number(),
  })
  .refine(
    (param) => param.min <= param.max && takesValue(param, param.initial),
    "A number starts from an initial value between its min and its max, on one of its steps from min"
  ) satisfies z.ZodType<TemplateParam>;

/**
 * What a strategy's `STRATEGY.md` says of it in its frontmatter: the command its code runs by, in
 * its own folder, the numbers that code takes, and the rules the app trades on, which read the
 * lines the code works out by name.
 */
export const strategyManifestSchema = z.strictObject({
  name: strategyNameSchema,
  description: z.string().trim().min(1).max(1024),
  run: z.string().trim().min(1).max(1000),
  params: z
    .record(paramNameSchema, strategyParamSchema)
    .refine(
      (params) => Object.keys(params).length <= MAX_STRATEGY_PARAMS,
      `A strategy takes ${MAX_STRATEGY_PARAMS} numbers at most`
    )
    .default({}),
  rules: ruleStrategySchema,
});

export type StrategyManifest = z.infer<typeof strategyManifestSchema>;

export type StrategyParams = Record<string, number>;

/**
 * The numbers a strategy's code runs with: those `given`, each within its bounds and on its steps,
 * and every other at its initial value. A number the strategy does not take is refused.
 */
export function strategyParams(
  manifest: StrategyManifest,
  given: Readonly<StrategyParams> = {}
): StrategyParams {
  const params = new Map(Object.entries(manifest.params));

  for (const name of Object.keys(given)) {
    if (!params.has(name)) {
      throw new Error(`${manifest.name} takes no number named ${name}`);
    }
  }

  return Object.fromEntries(
    [...params].map(([name, param]) => {
      const value = Object.hasOwn(given, name) ? given[name] : param.initial;

      if (!takesValue(param, value)) {
        throw new Error(
          `${manifest.name}'s ${name} is from ${param.min} to ${param.max} in steps of ${param.step}`
        );
      }

      return [name, value];
    })
  );
}

/** One run of a strategy's code: the numbers it takes, over the first `bars` of the bars it is handed. */
export interface StrategyJob {
  id: string;
  params: StrategyParams;
  bars: number;
}

/**
 * What a strategy's code is handed: the listing, and its bars as `strategyBars` gives them, each
 * figure a column, the times on the exchange's clock; and the jobs, each of which it answers with
 * the lines it works out.
 */
export interface StrategyInput {
  symbol: SymbolRef;
  interval: Interval;
  bars: {
    time: string[];
    open: number[];
    high: number[];
    low: number[];
    close: number[];
    volume: number[];
  };
  jobs: StrategyJob[];
}

/** `bars`, as `strategyBars` adjusts them, as a strategy's code is handed them for `jobs`. */
export function strategyInput(
  symbol: SymbolRef,
  interval: Interval,
  bars: readonly Candle[],
  jobs: StrategyJob[]
): StrategyInput {
  const figure = (key: "open" | "high" | "low" | "close" | "volume") =>
    bars.map((bar) => bar[key]);

  return {
    symbol,
    interval,
    bars: {
      time: bars.map((bar) => barTime(symbol.market, interval, bar.time)),
      open: figure("open"),
      high: figure("high"),
      low: figure("low"),
      close: figure("close"),
      volume: figure("volume"),
    },
    jobs,
  };
}

/**
 * The shorter runs the look-ahead check makes of a strategy's code: over the first fifth of the
 * bars, the first two fifths, three and four, each of two bars at least.
 */
export function lookAheadCuts(bars: number) {
  return [
    ...new Set(
      [1, 2, 3, 4]
        .map((fifths) => Math.floor((bars * fifths) / 5))
        .filter((cut) => cut >= 2 && cut < bars)
    ),
  ];
}

/**
 * The jobs that work out the lines of each of `params` over all `bars`, `run<n>` in their order,
 * and those the look-ahead check runs the first of them again with over fewer bars, `cut<n>`.
 */
export function strategyJobs(params: readonly StrategyParams[], bars: number) {
  return {
    runs: params.map((each, index): StrategyJob => ({
      id: `run${index}`,
      params: each,
      bars,
    })),
    cuts: lookAheadCuts(bars).map((cut, index): StrategyJob => ({
      id: `cut${index}`,
      params: params[0],
      bars: cut,
    })),
  };
}

/** What a strategy's code writes: by each job's id, its lines by name. */
const outputSchema = z.record(
  z.string(),
  z.record(lineNameSchema, z.array(z.number().nullable()))
);

// Python's `json` writes a missing value as NaN, which JSON has no word for, so a bare NaN or
// Infinity where a value goes reads as none.
const NOT_A_NUMBER = /(?<=[[,:]\s*)(?:NaN|-?Infinity)(?=\s*[,\]}])/g;

/**
 * Each job's lines from what a strategy's code wrote, `NaN` and `Infinity` read as no value. A job
 * it left out, or a line with other than one value for each of its job's bars, fails the run.
 */
export function readStrategyOutput(
  text: string,
  input: Pick<StrategyInput, "jobs">
): Map<string, StrategyLines> {
  let json: unknown;

  try {
    json = JSON.parse(text.replace(NOT_A_NUMBER, "null"));
  } catch (error) {
    throw new Error(
      `The strategy's code wrote what does not read as JSON: ${errorMessage(error)}`
    );
  }

  const parsed = outputSchema.safeParse(json);

  if (!parsed.success) {
    throw new Error(
      `The strategy's code wrote lines that do not read: ${z.prettifyError(parsed.error)}`
    );
  }

  const output = parsed.data;

  return new Map(
    input.jobs.map((job) => {
      const lines = Object.hasOwn(output, job.id) ? output[job.id] : undefined;

      if (lines === undefined) {
        throw new Error(`The strategy's code wrote no lines for ${job.id}`);
      }

      for (const [name, values] of Object.entries(lines)) {
        if (values.length !== job.bars) {
          throw new Error(
            `The strategy's code gave ${job.id} ${values.length} values of ${name} for ${job.bars} bars`
          );
        }
      }

      return [job.id, lines];
    })
  );
}

/** Where a strategy's code read bars after one it worked a line out for. */
export interface LookAhead {
  line: string;
  /** The first bar whose value changed once the code was handed the bars after it. */
  bar: number;
}

// Two values within this share of the larger are the same, as arithmetic in another order leaves them.
const SAME_VALUE = 1e-9;

const sameValue = (left: number | null, right: number | null) => {
  if (left === null || right === null || !Number.isFinite(left + right)) {
    return (
      (left === null || !Number.isFinite(left)) ===
      (right === null || !Number.isFinite(right))
    );
  }

  return (
    Math.abs(left - right) <=
    SAME_VALUE * Math.max(1, Math.abs(left), Math.abs(right))
  );
};

/** The first bar before `end` where `shorter` leaves a value of `values` other than it was; -1 where none. */
function firstChange(
  values: readonly (number | null)[],
  shorter: readonly (number | null)[],
  end: number
) {
  const stop = Math.min(shorter.length, end);

  for (let index = 0; index < stop; index++) {
    if (!sameValue(values[index], shorter[index])) return index;
  }

  return -1;
}

/**
 * The first bar where a line worked out over every bar differs from the same line worked out over
 * fewer, which a line read from its bar and the ones before it alone never does; `null` where none
 * does. A line one of the shorter runs left out differs from its first bar.
 */
export function lookAhead(
  full: StrategyLines,
  cuts: readonly StrategyLines[]
): LookAhead | null {
  let found: LookAhead | null = null;

  for (const cut of cuts) {
    for (const [name, values] of Object.entries(full)) {
      const end: number = found?.bar ?? values.length;

      const bar: number = Object.hasOwn(cut, name)
        ? firstChange(values, cut[name], end)
        : 0;

      if (bar !== -1 && bar < end) found = { line: name, bar };
    }
  }

  return found;
}
