import * as z from "zod";

import { isEnumValue } from "@solyx/utils/is";

import {
  MAX_SCAN_SERIES,
  distinctSeries,
  ruleStrategySchema,
} from "./backtest.ts";
import type { RuleStrategy } from "./backtest.ts";

/** The strategies a backtest is set up from without writing rules, each a rule traders name by a few numbers. */
export const StrategyTemplate = {
  MovingAverageCross: "movingAverageCross",
  RsiRebound: "rsiRebound",
  BollingerBreakout: "bollingerBreakout",
  BollingerReversion: "bollingerReversion",
  MacdCross: "macdCross",
  KdCross: "kdCross",
  ChannelBreakout: "channelBreakout",
} as const;

export type StrategyTemplate =
  (typeof StrategyTemplate)[keyof typeof StrategyTemplate];

/** The numbers templates take, each named as the rule it sets: lines' periods, bands' widths and levels. */
export const TemplateParamName = {
  Fast: "fast",
  Slow: "slow",
  Period: "period",
  Width: "width",
  Low: "low",
  High: "high",
  Entry: "entry",
  Exit: "exit",
} as const;

export type TemplateParamName =
  (typeof TemplateParamName)[keyof typeof TemplateParamName];

/** A number a template takes, from `min` to `max` in steps of `step`. */
export interface TemplateParam {
  min: number;
  max: number;
  step: number;
  initial: number;
}

/** The most values an axis of a grid takes, so a grid holds no more strategies than a scan runs. */
export const MAX_AXIS_VALUES = 20;

const STEP_TOLERANCE = 1e-9;

interface AxisSpan {
  from: number;
  to: number;
  step: number;
}

/** How many values an axis takes, worked out without making them. */
const axisCount = ({ from, to, step }: AxisSpan) =>
  Math.max(Math.floor((to - from) / step + STEP_TOLERANCE) + 1, 0);

const axisFits = (axis: AxisSpan) =>
  axisCount(axis) >= 1 && axisCount(axis) <= MAX_AXIS_VALUES;

/** A parameter's values down or across a grid: from `from` to `to` in steps of `step`. */
export const gridAxisSchema = z
  .strictObject({
    param: z.string(),
    from: z.number(),
    to: z.number(),
    step: z.number().positive(),
  })
  // Aborting, so no check of the grid it belongs to reads an axis this long.
  .refine(axisFits, {
    message: `An axis takes 1 to ${MAX_AXIS_VALUES} values`,
    abort: true,
  });

export type GridAxis = z.infer<typeof gridAxisSchema>;

interface TemplateDefinition<Param extends TemplateParamName> {
  params: Record<Param, TemplateParam>;
  /**
   * Years of daily bars that hold about twenty of its trades each side of a split and a fall as
   * well as a rise.
   */
  years: number;
  /** The grid a scan starts from: one parameter's values down, another's across. */
  grid: { rows: GridAxis; columns: GridAxis };
  rules(params: Record<Param, number>): Pick<RuleStrategy, "entry" | "exit">;
}

/** A template read by its numbers' names alone, which a setup's numbers are checked against. */
interface WideDefinition {
  params: Record<string, TemplateParam>;
  rules(params: Record<string, number>): Pick<RuleStrategy, "entry" | "exit">;
}

const define = <Param extends TemplateParamName>(
  definition: TemplateDefinition<Param>
) => definition;

const whole = (initial: number, min: number, max: number): TemplateParam => ({
  min,
  max,
  step: 1,
  initial,
});

const axis = (
  param: string,
  from: number,
  to: number,
  step: number
): GridAxis => ({ param, from, to, step });

/** The exits every template may add, as fractions of the price paid. */
export const ExitParam = {
  StopLoss: "stopLoss",
  TakeProfit: "takeProfit",
} as const;

export type ExitParam = (typeof ExitParam)[keyof typeof ExitParam];

export const EXIT_PARAMS: Record<ExitParam, TemplateParam> = {
  [ExitParam.StopLoss]: { min: 0.01, max: 0.5, step: 0.01, initial: 0.1 },
  [ExitParam.TakeProfit]: { min: 0.01, max: 2, step: 0.01, initial: 0.2 },
};

// Both Bollinger templates read the bands of one period and width.
const bands = {
  params: {
    period: whole(20, 5, 60),
    width: { min: 1, max: 3, step: 0.1, initial: 2 },
  },
  grid: {
    rows: axis("period", 10, 30, 5),
    columns: axis("width", 1.5, 2.5, 0.5),
  },
};

export const STRATEGY_TEMPLATES = {
  [StrategyTemplate.MovingAverageCross]: define({
    params: { fast: whole(20, 2, 120), slow: whole(60, 5, 250) },
    years: 10,
    grid: {
      rows: axis("slow", 40, 120, 10),
      columns: axis("fast", 5, 30, 5),
    },
    rules: ({ fast, slow }) => ({
      entry: { crossesAbove: [{ sma: fast }, { sma: slow }] },
      exit: { crossesBelow: [{ sma: fast }, { sma: slow }] },
    }),
  }),
  [StrategyTemplate.RsiRebound]: define({
    params: {
      period: whole(14, 2, 50),
      low: whole(30, 5, 50),
      high: whole(70, 50, 95),
    },
    years: 10,
    grid: { rows: axis("low", 20, 40, 5), columns: axis("high", 60, 80, 5) },
    rules: ({ period, low, high }) => ({
      entry: { crossesAbove: [{ rsi: period }, { value: low }] },
      exit: { crossesAbove: [{ rsi: period }, { value: high }] },
    }),
  }),
  [StrategyTemplate.BollingerBreakout]: define({
    ...bands,
    years: 10,
    rules: ({ period, width }) => ({
      entry: {
        crossesAbove: [
          { price: "close" },
          { bollinger: period, band: "upper", width },
        ],
      },
      exit: {
        crossesBelow: [
          { price: "close" },
          { bollinger: period, band: "middle", width },
        ],
      },
    }),
  }),
  [StrategyTemplate.BollingerReversion]: define({
    ...bands,
    years: 5,
    rules: ({ period, width }) => ({
      entry: {
        crossesAbove: [
          { price: "close" },
          { bollinger: period, band: "lower", width },
        ],
      },
      exit: {
        above: [
          { price: "close" },
          { bollinger: period, band: "middle", width },
        ],
      },
    }),
  }),
  // MACD(12, 26, 9) takes no numbers of its own, so its grid is of its exits.
  [StrategyTemplate.MacdCross]: define({
    params: {},
    years: 5,
    grid: {
      rows: axis(ExitParam.StopLoss, 0.04, 0.16, 0.02),
      columns: axis(ExitParam.TakeProfit, 0.1, 0.4, 0.05),
    },
    rules: () => ({
      entry: { crossesAbove: [{ macd: "macd" }, { macd: "signal" }] },
      exit: { crossesBelow: [{ macd: "macd" }, { macd: "signal" }] },
    }),
  }),
  // A golden cross low down to buy and a dead cross high up to sell, as KD(9) is read in Taiwan.
  [StrategyTemplate.KdCross]: define({
    params: { low: whole(20, 5, 50), high: whole(80, 50, 95) },
    years: 5,
    grid: { rows: axis("low", 10, 40, 5), columns: axis("high", 60, 90, 5) },
    rules: ({ low, high }) => ({
      entry: {
        all: [
          { crossesAbove: [{ kd: "k" }, { kd: "d" }] },
          { below: [{ kd: "k" }, { value: low }] },
        ],
      },
      exit: {
        all: [
          { crossesBelow: [{ kd: "k" }, { kd: "d" }] },
          { above: [{ kd: "k" }, { value: high }] },
        ],
      },
    }),
  }),
  [StrategyTemplate.ChannelBreakout]: define({
    params: { entry: whole(20, 5, 120), exit: whole(10, 5, 120) },
    years: 10,
    grid: {
      rows: axis("entry", 10, 60, 10),
      columns: axis("exit", 5, 30, 5),
    },
    rules: ({ entry, exit }) => ({
      entry: { above: [{ price: "close" }, { highest: entry }] },
      exit: { below: [{ price: "close" }, { lowest: exit }] },
    }),
  }),
} satisfies Record<StrategyTemplate, WideDefinition>;

// Read through its widest type, which takes any template's numbers by their names.
const definition = (template: StrategyTemplate): WideDefinition =>
  STRATEGY_TEMPLATES[template];

/** `name`'s bounds, one of `template`'s own numbers or an exit; `undefined` where it takes no such number. */
export function templateParam(template: StrategyTemplate, name: string) {
  if (isEnumValue(ExitParam, name)) return EXIT_PARAMS[name];

  return new Map(Object.entries(definition(template).params)).get(name);
}

/** Whether `value` is one `param` takes: within its bounds and on one of its steps. */
export function takesValue(param: TemplateParam, value: number) {
  const steps = (value - param.min) / param.step;

  return (
    value >= param.min - STEP_TOLERANCE &&
    value <= param.max + STEP_TOLERANCE &&
    Math.abs(steps - Math.round(steps)) < 1e-6
  );
}

/** A template with its numbers, and the exits it adds. */
export const templateSetupSchema = z
  .strictObject({
    template: z.enum(StrategyTemplate),
    params: z.record(z.string(), z.number()),
    stopLoss: z.number().optional(),
    takeProfit: z.number().optional(),
  })
  .superRefine((setup, context) => {
    const own = definition(setup.template).params;

    const refuse = (path: string[], message: string) =>
      context.addIssue({ code: "custom", path, message });

    const bounds = (name: string, param: TemplateParam) =>
      `${name} is from ${param.min} to ${param.max} in steps of ${param.step}`;

    for (const name of Object.keys(setup.params)) {
      if (!(name in own)) {
        refuse(["params", name], `${setup.template} takes no ${name}`);
      }
    }

    for (const [name, param] of Object.entries(own)) {
      const value = setup.params[name];

      if (value === undefined || !takesValue(param, value)) {
        refuse(["params", name], bounds(name, param));
      }
    }

    for (const name of Object.values(ExitParam)) {
      const value = setup[name];

      if (value !== undefined && !takesValue(EXIT_PARAMS[name], value)) {
        refuse([name], bounds(name, EXIT_PARAMS[name]));
      }
    }
  });

export type TemplateSetup = z.infer<typeof templateSetupSchema>;

/** What a backtest runs: a template with its numbers, or rules written out whole. */
export const strategySetupSchema = z.union([
  templateSetupSchema,
  z.strictObject({ rules: ruleStrategySchema }),
]);

export type StrategySetup = z.infer<typeof strategySetupSchema>;

/** A template with the numbers it starts from and no exits. */
export const initialSetup = (template: StrategyTemplate): TemplateSetup => ({
  template,
  params: Object.fromEntries(
    Object.entries(definition(template).params).map(([name, param]) => [
      name,
      param.initial,
    ])
  ),
});

/** The rules a setup runs. */
export function setupRules(setup: StrategySetup): RuleStrategy {
  if ("rules" in setup) return setup.rules;

  return {
    ...definition(setup.template).rules(setup.params),
    stopLoss: setup.stopLoss,
    takeProfit: setup.takeProfit,
  };
}

// Rounded so a step such as 0.1 adds up to the value a person would write.
const DECIMALS = 6;

/**
 * The values `axis` takes, from its first to its last by its step; one that would take more than
 * `MAX_AXIS_VALUES` fails before any is made.
 */
export function axisValues(axis: GridAxis) {
  const count = axisCount(axis);

  if (count > MAX_AXIS_VALUES) {
    throw new Error(`An axis takes ${MAX_AXIS_VALUES} values at most`);
  }

  return Array.from({ length: count }, (_, index) =>
    Number((axis.from + index * axis.step).toFixed(DECIMALS))
  );
}

/** `setup` with `param`, one of its template's numbers or an exit, set to `value`. */
function withParam(
  setup: TemplateSetup,
  param: string,
  value: number
): TemplateSetup {
  return param in EXIT_PARAMS
    ? { ...setup, [param]: value }
    : { ...setup, params: { ...setup.params, [param]: value } };
}

/** The setups of a grid over `setup`, row by row: `rows`' values down and `columns`' across. */
export const gridSetups = (
  setup: TemplateSetup,
  rows: GridAxis,
  columns: GridAxis
) =>
  axisValues(rows).flatMap((row) =>
    axisValues(columns).map((column) =>
      withParam(withParam(setup, rows.param, row), columns.param, column)
    )
  );

/** What keeps a grid from running, as data a window words. */
export const GridProblem = {
  /** An axis names a number its template does not take. */
  UnknownParam: "unknownParam",
  /** Both axes name the same number. */
  SameParam: "sameParam",
  /** An axis has a value its number does not take. */
  OffBounds: "offBounds",
  /** An axis has no values, or more than `MAX_AXIS_VALUES`. */
  AxisSize: "axisSize",
  /** Its strategies read more than `MAX_SCAN_SERIES` series between them. */
  TooManySeries: "tooManySeries",
} as const;

export type GridProblem = (typeof GridProblem)[keyof typeof GridProblem];

/** Why a grid over `setup` would not run; `undefined` where it would. */
export function gridProblem(
  setup: TemplateSetup,
  rows: GridAxis,
  columns: GridAxis
): GridProblem | undefined {
  const axes = [rows, columns].map((axis) => ({
    axis,
    param: templateParam(setup.template, axis.param),
  }));

  if (axes.some(({ param }) => param === undefined)) {
    return GridProblem.UnknownParam;
  }

  if (rows.param === columns.param) return GridProblem.SameParam;

  // Counted before any value is made, so a grid past what a scan runs never allocates.
  if (axes.some(({ axis }) => !axisFits(axis))) return GridProblem.AxisSize;

  if (
    axes.some(
      ({ axis, param }) =>
        param && axisValues(axis).some((value) => !takesValue(param, value))
    )
  ) {
    return GridProblem.OffBounds;
  }

  const series = distinctSeries(
    gridSetups(setup, rows, columns).map(setupRules)
  );

  return series > MAX_SCAN_SERIES ? GridProblem.TooManySeries : undefined;
}
