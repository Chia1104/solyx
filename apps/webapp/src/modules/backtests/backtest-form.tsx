import { useEffect, useMemo } from "react";

import {
  Button,
  Description,
  FieldError,
  Form,
  Label,
  NumberField,
  TextArea,
  TextField,
} from "@heroui/react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm, useWatch } from "react-hook-form";
import { useTranslation } from "react-i18next";
import * as z from "zod";

import type { BacktestSetup } from "@solyx/api/backtests";
import { defaultCosts, ruleStrategySchema } from "@solyx/core/backtest";
import { Interval, intervalSchema, isIntraday } from "@solyx/core/candles";
import type { SymbolRef } from "@solyx/core/market";
import {
  EXIT_PARAMS,
  ExitParam,
  STRATEGY_TEMPLATES,
  StrategyTemplate,
  TemplateParamName,
  initialSetup,
  setupRules,
} from "@solyx/core/strategy-templates";
import type {
  StrategySetup,
  TemplateParam,
} from "@solyx/core/strategy-templates";
import { isEnumValue } from "@solyx/utils/is";

import { OptionSelect } from "../../components/option-select.tsx";

import { yearChoices } from "./backtest-years.ts";

/** What the strategy select picks: one of the templates, or rules written out whole. */
const StrategyChoice = { ...StrategyTemplate, Rules: "rules" } as const;

type StrategyChoice = (typeof StrategyChoice)[keyof typeof StrategyChoice];

/** Shares of the sessions the in-sample stretch may take. */
const SPLITS = [0.5, 0.6, 2 / 3, 0.7, 0.75, 0.8];

const DEFAULT_SPLIT = 2 / 3;

const DEFAULT_CAPITAL = 1_000_000;

/** The years a template reads unless the user picks others, as far as `interval` reaches. */
const templateYears = (template: StrategyTemplate, interval: Interval) =>
  isIntraday(interval) ? 1 : STRATEGY_TEMPLATES[template].years;

/** The rules `text` writes out, or `null` where it is not JSON. */
function readRules(text: string) {
  try {
    return ruleStrategySchema.safeParse(JSON.parse(text));
  } catch {
    return null;
  }
}

const writtenOut = (setup: StrategySetup) =>
  JSON.stringify(setupRules(setup), null, 2);

/** Rebuilt per language so field errors come out localized; the setup's own bounds hold in its schema. */
function useFormSchema() {
  const { t } = useTranslation();

  return useMemo(() => {
    const number = z.number({ error: t("backtests.form.required") });
    // An empty field holds NaN, which reads as no exit.
    const exit = z.union([z.nan(), z.number()]);

    return z
      .object({
        strategy: z.enum(StrategyChoice),
        params: z.record(z.string(), number),
        stopLoss: exit,
        takeProfit: exit,
        rules: z.string(),
        interval: intervalSchema,
        years: z.number(),
        split: z.number(),
        capital: number.positive({ error: t("backtests.form.positive") }),
        commissionRate: number.min(0),
        slippageTicks: number.int().min(0),
      })
      .superRefine(({ strategy, rules }, context) => {
        if (strategy !== StrategyChoice.Rules) return;

        const read = readRules(rules);

        if (read?.success) return;

        context.addIssue({
          code: "custom",
          path: ["rules"],
          message: read
            ? t("backtests.form.rules-invalid", {
                reason: z.prettifyError(read.error),
              })
            : t("backtests.form.rules-json"),
        });
      });
  }, [t]);
}

type FormValues = z.output<ReturnType<typeof useFormSchema>>;

const optionalExit = (value: number | undefined) =>
  value === undefined ? Number.NaN : value;

/** The form as a setup it ran, or as the app starts one for `symbol`. */
function formValues(symbol: SymbolRef, setup?: BacktestSetup): FormValues {
  const costs = { ...defaultCosts(symbol), ...setup?.costs };

  const strategy =
    setup?.strategy ?? initialSetup(StrategyTemplate.MovingAverageCross);

  const interval = setup?.interval ?? Interval.OneDay;

  const template =
    "rules" in strategy
      ? StrategyTemplate.MovingAverageCross
      : strategy.template;

  return {
    strategy: "rules" in strategy ? StrategyChoice.Rules : strategy.template,
    params:
      "rules" in strategy ? initialSetup(template).params : strategy.params,
    stopLoss:
      "rules" in strategy ? Number.NaN : optionalExit(strategy.stopLoss),
    takeProfit:
      "rules" in strategy ? Number.NaN : optionalExit(strategy.takeProfit),
    rules: writtenOut(strategy),
    interval,
    years: setup?.years ?? templateYears(template, interval),
    split: setup?.split ?? DEFAULT_SPLIT,
    capital: setup?.capital ?? DEFAULT_CAPITAL,
    commissionRate: costs.commissionRate,
    slippageTicks: costs.slippageTicks,
  };
}

const exitValue = (value: number) => (Number.isNaN(value) ? undefined : value);

function toSetup(symbol: SymbolRef, values: FormValues): BacktestSetup {
  const strategy: StrategySetup = isEnumValue(StrategyTemplate, values.strategy)
    ? {
        template: values.strategy,
        // Only the numbers its template takes, whichever it was switched from.
        params: Object.fromEntries(
          Object.keys(STRATEGY_TEMPLATES[values.strategy].params).map(
            (name) => [name, values.params[name]]
          )
        ),
        stopLoss: exitValue(values.stopLoss),
        takeProfit: exitValue(values.takeProfit),
      }
    : { rules: ruleStrategySchema.parse(JSON.parse(values.rules)) };

  return {
    symbol: { market: symbol.market, symbol: symbol.symbol },
    interval: values.interval,
    years: values.years,
    strategy,
    split: values.split,
    capital: values.capital,
    costs: {
      commissionRate: values.commissionRate,
      slippageTicks: values.slippageTicks,
    },
  };
}

/** A number the form holds, empty as NaN, snapped to `param`'s bounds and steps. */
function ParamField({
  label,
  description,
  param,
  value,
  invalid,
  formatOptions = { maximumFractionDigits: 4 },
  onChange,
  onBlur,
}: {
  label: string;
  description?: string;
  param: Omit<TemplateParam, "initial">;
  value: number;
  invalid?: string;
  formatOptions?: Intl.NumberFormatOptions;
  onChange: (value: number) => void;
  onBlur: () => void;
}) {
  return (
    <NumberField
      isInvalid={invalid !== undefined}
      minValue={param.min}
      maxValue={param.max}
      step={param.step}
      formatOptions={formatOptions}
      value={value}
      onChange={(next) => onChange(next ?? Number.NaN)}
      onBlur={onBlur}>
      <Label>{label}</Label>
      <NumberField.Group>
        <NumberField.DecrementButton />
        <NumberField.Input className="text-center tabular-nums" />
        <NumberField.IncrementButton />
      </NumberField.Group>
      {description === undefined ? null : (
        <Description>{description}</Description>
      )}
      <FieldError>{invalid}</FieldError>
    </NumberField>
  );
}

// What the costs' fields take: a fraction for the commission, whole ticks for the slippage.
const COMMISSION: Omit<TemplateParam, "initial"> = {
  min: 0,
  max: 0.01,
  step: 0.000001,
};

const WHOLE_PERCENT: Intl.NumberFormatOptions = {
  style: "percent",
  maximumFractionDigits: 0,
};

// A Taiwan broker's commission is 0.1425%.
const FINE_PERCENT: Intl.NumberFormatOptions = {
  style: "percent",
  maximumFractionDigits: 4,
};

const SLIPPAGE: Omit<TemplateParam, "initial"> = { min: 0, max: 20, step: 1 };

// Stepped from its least, so the million it starts from is on a step.
const CAPITAL: Omit<TemplateParam, "initial"> = {
  min: 100_000,
  max: 1_000_000_000,
  step: 100_000,
};

/**
 * Sets a backtest up for `symbol`: a template with its numbers or rules written out, the interval
 * and years of bars it reads, where its out-of-sample stretch starts and what trades cost. It
 * starts from the setup the panel ran last, and follows it as it changes elsewhere.
 */
export function BacktestForm({
  symbol,
  setup,
  isRunning,
  onRun,
}: {
  symbol: SymbolRef;
  setup: BacktestSetup | undefined;
  isRunning: boolean;
  onRun: (setup: BacktestSetup) => void;
}) {
  const { t, i18n } = useTranslation();
  const schema = useFormSchema();

  const percent = new Intl.NumberFormat(i18n.language, {
    style: "percent",
    maximumFractionDigits: 0,
  });

  const form = useForm({
    resolver: zodResolver(schema),
    // NumberField commits on blur; revalidating then would move the button under the click.
    reValidateMode: "onSubmit",
    defaultValues: formValues(symbol, setup),
  });

  useEffect(() => {
    if (setup) form.reset(formValues(symbol, setup));
  }, [form, symbol, setup]);

  const strategy = useWatch({ control: form.control, name: "strategy" });
  const interval = useWatch({ control: form.control, name: "interval" });
  const template = isEnumValue(StrategyTemplate, strategy) ? strategy : null;

  const submit = form.handleSubmit((values) => onRun(toSetup(symbol, values)));

  function pickStrategy(next: StrategyChoice) {
    const values = form.getValues();

    if (isEnumValue(StrategyTemplate, next)) {
      form.setValue("params", initialSetup(next).params);
      form.setValue("years", templateYears(next, values.interval));
    } else if (template) {
      // Written out from the template shown, so editing it starts from what it ran.
      form.setValue("rules", writtenOut(toSetup(symbol, values).strategy));
    }

    form.setValue("strategy", next);
    form.clearErrors();
  }

  function pickInterval(next: Interval) {
    const years = form.getValues("years");

    form.setValue("interval", next);

    if (!yearChoices(next).includes(years)) {
      form.setValue(
        "years",
        template ? templateYears(template, next) : yearChoices(next)[0]
      );
    }
  }

  return (
    <Form
      validationBehavior="aria"
      // Its own width rather than the page's: beside the run it is narrow, above it wide.
      className="@container/setup flex flex-col gap-3"
      onSubmit={(event) => void submit(event)}>
      <OptionSelect
        label={t("backtests.form.strategy")}
        description={
          template
            ? t(`backtests.templates.${template}.description`)
            : t("backtests.form.rules-hint")
        }
        options={Object.values(StrategyChoice).map((id) => ({
          id,
          label:
            id === StrategyChoice.Rules
              ? t("backtests.form.rules")
              : t(`backtests.templates.${id}.name`),
        }))}
        value={strategy}
        onChange={pickStrategy}
      />
      {template ? (
        <div className="grid grid-cols-2 gap-3 @min-[36rem]/setup:grid-cols-4">
          {Object.entries(STRATEGY_TEMPLATES[template].params).flatMap(
            ([name, param]) =>
              isEnumValue(TemplateParamName, name)
                ? [
                    <Controller
                      key={`${template}.${name}`}
                      control={form.control}
                      name={`params.${name}`}
                      render={({ field, fieldState }) => (
                        <ParamField
                          label={t(`backtests.params.${name}`)}
                          param={param}
                          value={field.value}
                          invalid={fieldState.error?.message}
                          onChange={field.onChange}
                          onBlur={field.onBlur}
                        />
                      )}
                    />,
                  ]
                : []
          )}
          {Object.values(ExitParam).map((name) => (
            <Controller
              key={name}
              control={form.control}
              name={name}
              render={({ field, fieldState }) => (
                <ParamField
                  label={t(`backtests.form.${name}`)}
                  description={t("backtests.form.exit-hint")}
                  param={EXIT_PARAMS[name]}
                  value={field.value}
                  invalid={fieldState.error?.message}
                  formatOptions={WHOLE_PERCENT}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                />
              )}
            />
          ))}
        </div>
      ) : (
        <Controller
          control={form.control}
          name="rules"
          render={({ field, fieldState }) => (
            <TextField isInvalid={fieldState.invalid}>
              <Label>{t("backtests.form.rules-label")}</Label>
              <TextArea
                {...field}
                rows={10}
                spellCheck={false}
                className="font-mono text-xs"
              />
              <FieldError>{fieldState.error?.message}</FieldError>
            </TextField>
          )}
        />
      )}
      <div className="grid grid-cols-2 gap-3 @min-[36rem]/setup:grid-cols-4">
        <OptionSelect
          label={t("backtests.form.interval")}
          options={Object.values(Interval).map((id) => ({
            id,
            label: t(`chart.intervals.${id}`),
          }))}
          value={interval}
          onChange={pickInterval}
        />
        <Controller
          control={form.control}
          name="years"
          render={({ field }) => (
            <OptionSelect
              label={t("backtests.form.years")}
              options={yearChoices(interval).map((years) => ({
                id: String(years),
                label: t("backtests.form.years-option", { count: years }),
              }))}
              value={String(field.value)}
              onChange={(next) => field.onChange(Number(next))}
            />
          )}
        />
        <Controller
          control={form.control}
          name="split"
          render={({ field }) => (
            <OptionSelect
              label={t("backtests.form.split")}
              description={t("backtests.form.split-hint")}
              options={SPLITS.map((share) => ({
                id: String(share),
                label: percent.format(share),
              }))}
              value={String(field.value)}
              onChange={(next) => field.onChange(Number(next))}
            />
          )}
        />
        <Controller
          control={form.control}
          name="capital"
          render={({ field, fieldState }) => (
            <ParamField
              label={t("backtests.form.capital")}
              param={CAPITAL}
              value={field.value}
              invalid={fieldState.error?.message}
              onChange={field.onChange}
              onBlur={field.onBlur}
            />
          )}
        />
        <Controller
          control={form.control}
          name="commissionRate"
          render={({ field, fieldState }) => (
            <ParamField
              label={t("backtests.form.commission")}
              param={COMMISSION}
              value={field.value}
              invalid={fieldState.error?.message}
              formatOptions={FINE_PERCENT}
              onChange={field.onChange}
              onBlur={field.onBlur}
            />
          )}
        />
        <Controller
          control={form.control}
          name="slippageTicks"
          render={({ field, fieldState }) => (
            <ParamField
              label={t("backtests.form.slippage")}
              param={SLIPPAGE}
              value={field.value}
              invalid={fieldState.error?.message}
              onChange={field.onChange}
              onBlur={field.onBlur}
            />
          )}
        />
      </div>
      <Button type="submit" variant="secondary" isPending={isRunning}>
        {t("backtests.form.run")}
      </Button>
    </Form>
  );
}
