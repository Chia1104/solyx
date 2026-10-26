import { useMemo } from "react";

import { omit } from "es-toolkit";
import { useTranslation } from "react-i18next";
import * as z from "zod";

import { BacktestMode } from "@solyx/api/backtests";
import type {
  BacktestRequest,
  BacktestSetup,
  OwnSetup,
  RollingSetup,
  ScanSetup,
  WalkForwardSetup,
} from "@solyx/api/backtests";
import {
  MAX_SCAN_SERIES,
  defaultCosts,
  distinctSeries,
  ruleStrategySchema,
} from "@solyx/core/backtest";
import { Interval, intervalSchema, isIntraday } from "@solyx/core/candles";
import type { SymbolRef } from "@solyx/core/market";
import {
  GridProblem,
  MAX_AXIS_VALUES,
  STRATEGY_TEMPLATES,
  StrategyTemplate,
  axisValues,
  gridAxisSchema,
  gridProblem,
  gridSetups,
  initialSetup,
  setupRules,
} from "@solyx/core/strategy-templates";
import type {
  GridAxis,
  StrategySetup,
  TemplateSetup,
} from "@solyx/core/strategy-templates";
import { isEnumValue } from "@solyx/utils/is";

/** What the strategy select picks: one of the templates, rules written out whole, or one of the user's. */
export const StrategyChoice = {
  ...StrategyTemplate,
  Rules: "rules",
  Own: "own",
} as const;

export type StrategyChoice =
  (typeof StrategyChoice)[keyof typeof StrategyChoice];

/** Shares of the sessions the in-sample stretch may take. */
export const SPLITS = [0.5, 0.6, 2 / 3, 0.7, 0.75, 0.8];

const DEFAULT_SPLIT = 2 / 3;

const DEFAULT_CAPITAL = 1_000_000;

/** The months a rolling window may run, and those its starts may lie apart. */
const ROLLING_MONTHS = [3, 6, 12, 24, 36, 60];

export const ROLLING_STEPS = [1, 3, 6, 12];

const DEFAULT_ROLLING = { months: 36, step: 1 };

/**
 * The months a rolling window may run over `years` of bars: the first month read is part of one and
 * the month under way is not over, so two fewer than they hold at most.
 */
export const rollingMonthChoices = (years: number) =>
  ROLLING_MONTHS.filter((months) => months <= years * 12 - 2);

/** `months` where a window that long fits `years` of bars, else the longest that does. */
export function fittingMonths(years: number, months: number) {
  const choices = rollingMonthChoices(years);

  return choices.includes(months) ? months : (choices.at(-1) ?? months);
}

/** The years a template reads unless the user picks others, as far as `interval` reaches. */
export const templateYears = (
  template: StrategyTemplate,
  interval: Interval
) => (isIntraday(interval) ? 1 : STRATEGY_TEMPLATES[template].years);

/** The rules `text` writes out, or `null` where it is not JSON. */
function readRules(text: string) {
  try {
    return ruleStrategySchema.safeParse(JSON.parse(text));
  } catch {
    return null;
  }
}

export const writtenOut = (setup: StrategySetup) =>
  JSON.stringify(setupRules(setup), null, 2);

const axisSchema = z.object({
  param: z.string(),
  from: z.number(),
  to: z.number(),
  step: z.number(),
});

/** The words for why a grid would not run. */
function useGridProblemText() {
  const { t } = useTranslation();

  return (problem: GridProblem) =>
    t(`backtests.grid.problems.${problem}`, {
      values: MAX_AXIS_VALUES,
      series: MAX_SCAN_SERIES,
    });
}

/**
 * Rebuilt per language and mode so field errors come out localized; the setup's own bounds hold in
 * its schema.
 */
export function useFormSchema(mode: BacktestMode) {
  const { t } = useTranslation();
  const problemText = useGridProblemText();

  return useMemo(() => {
    const number = z.number({ error: t("backtests.form.required") });
    // An empty field holds NaN, which reads as no exit, or as the default sessions of a walk.
    const optional = z.union([z.nan(), z.number()]);

    return z
      .object({
        strategy: z.enum(StrategyChoice),
        /** The user's strategy picked, by its name, while `strategy` is `own`. */
        own: z.string(),
        params: z.record(z.string(), number),
        stopLoss: optional,
        takeProfit: optional,
        rules: z.string(),
        interval: intervalSchema,
        years: z.number(),
        split: z.number(),
        capital: number.positive({ error: t("backtests.form.positive") }),
        commissionRate: number.min(0),
        slippageTicks: number.int().min(0),
        rows: axisSchema,
        columns: axisSchema,
        train: optional,
        test: optional,
        months: z.number(),
        step: z.number(),
      })
      .superRefine((values, context) => {
        const read =
          values.strategy === StrategyChoice.Rules
            ? readRules(values.rules)
            : undefined;

        if (read === null || read?.success === false) {
          context.addIssue({
            code: "custom",
            path: ["rules"],
            message: read
              ? t("backtests.form.rules-invalid", {
                  reason: z.prettifyError(read.error),
                })
              : t("backtests.form.rules-json"),
          });
        }

        const setup = templateSetup(values);

        const gridded =
          mode === BacktestMode.Scan || mode === BacktestMode.WalkForward;

        const problem = gridded
          ? setup
            ? gridProblem(setup, values.rows, values.columns)
            : ownGridProblem(values)
          : undefined;

        if (problem) {
          context.addIssue({
            code: "custom",
            path: ["rows"],
            message: problemText(problem),
          });
        }
      });
  }, [t, mode, problemText]);
}

export type FormValues = z.output<ReturnType<typeof useFormSchema>>;

const optionalNumber = (value: number | undefined) =>
  value === undefined ? Number.NaN : value;

const presentNumber = (value: number) =>
  Number.isNaN(value) ? undefined : value;

/** What a panel ran in any of its modes, which the form starts from. */
export type PanelSetup =
  | BacktestSetup
  | ScanSetup
  | WalkForwardSetup
  | RollingSetup;

/** What the panel runs for `symbol` before the user has run anything. */
function initialRun(symbol: SymbolRef): BacktestSetup {
  const strategy = initialSetup(StrategyTemplate.MovingAverageCross);

  return {
    symbol,
    interval: Interval.OneDay,
    years: STRATEGY_TEMPLATES[strategy.template].years,
    strategy,
    split: DEFAULT_SPLIT,
    capital: DEFAULT_CAPITAL,
    costs: defaultCosts(symbol),
  };
}

/** The strategy's fields as a setup ran it, and the template its grid starts from. */
function strategyValues(strategy: StrategySetup | OwnSetup) {
  const template = StrategyTemplate.MovingAverageCross;

  if ("name" in strategy) {
    return {
      template,
      values: {
        strategy: StrategyChoice.Own,
        own: strategy.name,
        params: strategy.params,
        stopLoss: Number.NaN,
        takeProfit: Number.NaN,
        rules: writtenOut(initialSetup(template)),
      },
    };
  }

  const rules = writtenOut(strategy);

  if ("rules" in strategy) {
    return {
      template,
      values: {
        strategy: StrategyChoice.Rules,
        own: "",
        params: initialSetup(template).params,
        stopLoss: Number.NaN,
        takeProfit: Number.NaN,
        rules,
      },
    };
  }

  return {
    template: strategy.template,
    values: {
      strategy: strategy.template,
      own: "",
      params: strategy.params,
      stopLoss: optionalNumber(strategy.stopLoss),
      takeProfit: optionalNumber(strategy.takeProfit),
      rules,
    },
  };
}

/** The form as a setup it ran, or as the app starts one for `symbol`. */
export function formValues(
  symbol: SymbolRef,
  given: PanelSetup | undefined
): FormValues {
  const setup = given ?? initialRun(symbol);
  const costs = { ...defaultCosts(symbol), ...setup.costs };
  const { template, values } = strategyValues(setup.strategy);
  const grid = "rows" in setup ? setup : STRATEGY_TEMPLATES[template].grid;

  const walk: Partial<Pick<WalkForwardSetup, "train" | "test">> =
    "train" in setup || "test" in setup ? setup : {};

  const rolling = "months" in setup ? setup : DEFAULT_ROLLING;

  return {
    ...values,
    interval: setup.interval,
    years: setup.years,
    split: "split" in setup ? setup.split : DEFAULT_SPLIT,
    capital: setup.capital ?? DEFAULT_CAPITAL,
    commissionRate: costs.commissionRate,
    slippageTicks: costs.slippageTicks,
    rows: grid.rows,
    columns: grid.columns,
    train: optionalNumber(walk.train),
    test: optionalNumber(walk.test),
    months: fittingMonths(setup.years, rolling.months),
    step: rolling.step,
  };
}

/** The fields a template's setup, or a strategy of the user's, is read from. */
export interface TemplateValues {
  strategy: StrategyChoice;
  own: string;
  params: Record<string, number>;
  stopLoss: number;
  takeProfit: number;
}

/** The user's strategy the form sets up, with its numbers; `null` for a template or rules. */
function ownSetup(values: TemplateValues): OwnSetup | null {
  return values.strategy === StrategyChoice.Own
    ? { name: values.own, params: values.params }
    : null;
}

/** Why a grid over the user's strategy would not run; its numbers are its folder's to check. */
function ownGridProblem({
  rows,
  columns,
}: {
  rows: GridAxis;
  columns: GridAxis;
}): GridProblem | undefined {
  if (rows.param === columns.param) return GridProblem.SameParam;

  return [rows, columns].every((axis) => gridAxisSchema.safeParse(axis).success)
    ? undefined
    : GridProblem.AxisSize;
}

/** The template the form sets up, with only the numbers it takes; `null` for written rules. */
function templateSetup(values: TemplateValues): TemplateSetup | null {
  const { strategy } = values;

  if (!isEnumValue(StrategyTemplate, strategy)) return null;

  return {
    template: strategy,
    // Only the numbers its template takes, whichever it was switched from.
    params: Object.fromEntries(
      Object.keys(STRATEGY_TEMPLATES[strategy].params).map((name) => [
        name,
        values.params[name],
      ])
    ),
    stopLoss: presentNumber(values.stopLoss),
    takeProfit: presentNumber(values.takeProfit),
  };
}

/** What every mode reads and trades. */
const reach = (symbol: SymbolRef, values: FormValues) => ({
  symbol: { market: symbol.market, symbol: symbol.symbol },
  interval: values.interval,
  years: values.years,
  capital: values.capital,
  costs: {
    commissionRate: values.commissionRate,
    slippageTicks: values.slippageTicks,
  },
});

/** The single run the form sets up. */
export function runSetup(symbol: SymbolRef, values: FormValues): BacktestSetup {
  return {
    ...reach(symbol, values),
    strategy: templateSetup(values) ??
      ownSetup(values) ?? {
        rules: ruleStrategySchema.parse(JSON.parse(values.rules)),
      },
    split: values.split,
  };
}

/** What the form asks the panel to run in `mode`. */
export function formRequest(
  mode: BacktestMode,
  symbol: SymbolRef,
  values: FormValues
): BacktestRequest {
  if (mode === BacktestMode.Rolling) {
    return {
      mode,
      setup: {
        ...omit(runSetup(symbol, values), ["split"]),
        months: values.months,
        step: values.step,
      },
    };
  }

  const strategy = templateSetup(values) ?? ownSetup(values);

  if (mode === BacktestMode.Run || !strategy) {
    return { mode: BacktestMode.Run, setup: runSetup(symbol, values) };
  }

  const grid = {
    ...reach(symbol, values),
    strategy,
    rows: values.rows,
    columns: values.columns,
  };

  return mode === BacktestMode.Scan
    ? { mode, setup: { ...grid, split: values.split } }
    : {
        mode,
        setup: {
          ...grid,
          train: presentNumber(values.train),
          test: presentNumber(values.test),
        },
      };
}

// Problems found before the grid's values are made, which leave nothing to count.
const UNCOUNTED: readonly GridProblem[] = [
  GridProblem.UnknownParam,
  GridProblem.SameParam,
  GridProblem.AxisSize,
];

/** A grid's size in strategies and series, or why it would not run, as the form holds it now. */
export function useGridSize(
  values: TemplateValues,
  rows: GridAxis,
  columns: GridAxis
) {
  const problemText = useGridProblemText();
  const setup = templateSetup(values);

  if (ownSetup(values)) {
    const problem = ownGridProblem({ rows, columns });

    return {
      cells: problem ? 0 : axisValues(rows).length * axisValues(columns).length,
      series: null,
      problem: problem ? problemText(problem) : undefined,
    };
  }

  if (!setup) return null;

  const problem = gridProblem(setup, rows, columns);

  if (problem && UNCOUNTED.includes(problem)) {
    return { cells: 0, series: 0, problem: problemText(problem) };
  }

  const setups = gridSetups(setup, rows, columns);

  return {
    cells: setups.length,
    series: distinctSeries(setups.map(setupRules)),
    problem: problem ? problemText(problem) : undefined,
  };
}
