import { useEffect, useEffectEvent } from "react";

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
import { useQuery } from "@tanstack/react-query";
import type { TFunction } from "i18next";
import { Controller, useForm, useWatch } from "react-hook-form";
import type { Control, UseFormReturn } from "react-hook-form";
import { useTranslation } from "react-i18next";

import { BacktestMode } from "@solyx/api/backtests";
import type { BacktestRequest } from "@solyx/api/backtests";
import type { StrategyEntry } from "@solyx/api/strategies";
import { MAX_SCAN_SERIES } from "@solyx/core/backtest";
import { Interval } from "@solyx/core/candles";
import type { SymbolRef } from "@solyx/core/market";
import {
  EXIT_PARAMS,
  ExitParam,
  STRATEGY_TEMPLATES,
  StrategyTemplate,
  TemplateParamName,
  initialSetup,
  templateParam,
} from "@solyx/core/strategy-templates";
import type { TemplateParam } from "@solyx/core/strategy-templates";
import { isEnumValue } from "@solyx/utils/is";

import { OptionSelect } from "../../components/option-select.tsx";
import { strategiesQuery } from "../strategies/strategies-query.ts";
import { StrategyAllow } from "../strategies/strategy-allow.tsx";

import { WriteStrategy } from "./agent-bridge.tsx";
import {
  ROLLING_STEPS,
  SPLITS,
  StrategyChoice,
  fittingMonths,
  formRequest,
  formValues,
  rollingMonthChoices,
  runSetup,
  templateYears,
  useFormSchema,
  useGridSize,
  writtenOut,
} from "./backtest-form-values.ts";
import type { FormValues, PanelSetup } from "./backtest-form-values.ts";
import { defaultAxis, gridParams, paramAxis } from "./backtest-params.ts";
import { yearChoices } from "./backtest-years.ts";
import { GridAxisFields, GridSummary } from "./grid-fields.tsx";
import type { GridNumbers } from "./grid-fields.tsx";

/** A number's bounds, as a field snaps to them. */
type Bounds = Omit<TemplateParam, "initial">;

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
  param: Bounds;
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
const COMMISSION: Bounds = { min: 0, max: 0.01, step: 0.000001 };

const WHOLE_PERCENT: Intl.NumberFormatOptions = {
  style: "percent",
  maximumFractionDigits: 0,
};

// A Taiwan broker's commission is 0.1425%.
const FINE_PERCENT: Intl.NumberFormatOptions = {
  style: "percent",
  maximumFractionDigits: 4,
};

const SLIPPAGE: Bounds = { min: 0, max: 20, step: 1 };

// A walk forward's sessions, empty for its defaults.
const SESSIONS: Bounds = { min: 5, max: 5_000, step: 1 };

// Stepped from its least, so the million it starts from is on a step.
const CAPITAL: Bounds = { min: 100_000, max: 1_000_000_000, step: 100_000 };

const FIELDS = "grid grid-cols-2 gap-3 @min-[36rem]/setup:grid-cols-4";

/** A number of the form by its name, with its bounds and the words beside it. */
function NumberControl({
  control,
  name,
  label,
  description,
  param,
  formatOptions,
}: {
  control: Control<FormValues>;
  name:
    | `params.${string}`
    | ExitParam
    | "capital"
    | "commissionRate"
    | "slippageTicks"
    | "train"
    | "test";
  label: string;
  description?: string;
  param: Bounds;
  formatOptions?: Intl.NumberFormatOptions;
}) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <ParamField
          label={label}
          description={description}
          param={param}
          value={field.value}
          invalid={fieldState.error?.message}
          formatOptions={formatOptions}
          onChange={field.onChange}
          onBlur={field.onBlur}
        />
      )}
    />
  );
}

/** The numbers a grid over a template runs along: its own, then its exits. */
const templateNumbers = (template: StrategyTemplate): GridNumbers => ({
  names: gridParams(template),
  own: false,
  bounds: (param) => templateParam(template, param),
  axis: (param) => defaultAxis(template, param),
});

/** The numbers a grid over a strategy of the user's runs along: those its code takes. */
const ownNumbers = (strategy: StrategyEntry): GridNumbers => ({
  names: Object.keys(strategy.params),
  own: true,
  bounds: (param) =>
    Object.hasOwn(strategy.params, param) ? strategy.params[param] : undefined,
  axis: (param) => paramAxis(param, strategy.params[param]),
});

/**
 * A template's own numbers and its exits, a strategy of the user's with the numbers its code
 * takes, or the rules written out in their place; nothing while the user's own are picked and
 * there is none to pick.
 */
function StrategyFields({
  control,
  choice,
  template,
  own,
}: {
  control: Control<FormValues>;
  choice: StrategyChoice;
  template: StrategyTemplate | null;
  own: StrategyEntry | null;
}) {
  const { t } = useTranslation();

  if (choice === StrategyChoice.Own && !own) return null;

  if (own) {
    return (
      <div className={FIELDS}>
        {Object.entries(own.params).map(([name, param]) => (
          <NumberControl
            key={`${own.name}.${name}`}
            control={control}
            name={`params.${name}`}
            label={name}
            param={param}
          />
        ))}
      </div>
    );
  }

  if (!template) {
    return (
      <Controller
        control={control}
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
    );
  }

  return (
    <div className={FIELDS}>
      {Object.entries(STRATEGY_TEMPLATES[template].params).flatMap(
        ([name, param]) =>
          isEnumValue(TemplateParamName, name)
            ? [
                <NumberControl
                  key={`${template}.${name}`}
                  control={control}
                  name={`params.${name}`}
                  label={t(`backtests.params.${name}`)}
                  param={param}
                />,
              ]
            : []
      )}
      {Object.values(ExitParam).map((name) => (
        <NumberControl
          key={name}
          control={control}
          name={name}
          label={t(`backtests.form.${name}`)}
          description={t("backtests.form.exit-hint")}
          param={EXIT_PARAMS[name]}
          formatOptions={WHOLE_PERCENT}
        />
      ))}
    </div>
  );
}

/** The grid a scan or a walk forward runs: one number down, another across, and its size. */
function GridFields({
  control,
  numbers,
}: {
  control: Control<FormValues>;
  numbers: GridNumbers;
}) {
  const { t } = useTranslation();

  const [strategy, own, params, stopLoss, takeProfit, rows, columns] = useWatch(
    {
      control,
      name: [
        "strategy",
        "own",
        "params",
        "stopLoss",
        "takeProfit",
        "rows",
        "columns",
      ],
    }
  );

  const size = useGridSize(
    { strategy, own, params, stopLoss, takeProfit },
    rows,
    columns
  );

  return (
    <div className="flex flex-col gap-2">
      <Controller
        control={control}
        name="rows"
        render={({ field }) => (
          <GridAxisFields
            label={t("backtests.grid.rows")}
            numbers={numbers}
            axis={field.value}
            onChange={field.onChange}
          />
        )}
      />
      <Controller
        control={control}
        name="columns"
        render={({ field }) => (
          <GridAxisFields
            label={t("backtests.grid.columns")}
            numbers={numbers}
            axis={field.value}
            onChange={field.onChange}
          />
        )}
      />
      {size ? (
        <GridSummary
          cells={size.cells}
          series={size.series}
          maxSeries={MAX_SCAN_SERIES}
          problem={size.problem}
        />
      ) : null}
    </div>
  );
}

/** How long each rolling window runs, as far as the years read hold one, and how far apart they start. */
function RollingFields({ control }: { control: Control<FormValues> }) {
  const { t } = useTranslation();
  const years = useWatch({ control, name: "years" });

  return (
    <>
      <Controller
        control={control}
        name="months"
        render={({ field }) => (
          <OptionSelect
            label={t("backtests.rolling.months")}
            description={t("backtests.rolling.months-hint")}
            options={rollingMonthChoices(years).map((months) => ({
              id: String(months),
              label: t("backtests.rolling.months-option", { count: months }),
            }))}
            value={String(field.value)}
            onChange={(next) => field.onChange(Number(next))}
          />
        )}
      />
      <Controller
        control={control}
        name="step"
        render={({ field }) => (
          <OptionSelect
            label={t("backtests.rolling.step")}
            options={ROLLING_STEPS.map((step) => ({
              id: String(step),
              label: t("backtests.rolling.step-option", { count: step }),
            }))}
            value={String(field.value)}
            onChange={(next) => field.onChange(Number(next))}
          />
        )}
      />
    </>
  );
}

/** Where its stretches split, or a walk forward's sessions or rolling windows in their place. */
function StretchFields({
  control,
  mode,
}: {
  control: Control<FormValues>;
  mode: BacktestMode;
}) {
  const { t, i18n } = useTranslation();

  const percent = new Intl.NumberFormat(i18n.language, {
    style: "percent",
    maximumFractionDigits: 0,
  });

  if (mode === BacktestMode.Rolling) return <RollingFields control={control} />;

  if (mode === BacktestMode.WalkForward) {
    return (
      <>
        <NumberControl
          control={control}
          name="train"
          label={t("backtests.walk.train")}
          description={t("backtests.walk.train-hint")}
          param={SESSIONS}
        />
        <NumberControl
          control={control}
          name="test"
          label={t("backtests.walk.test")}
          description={t("backtests.walk.test-hint")}
          param={SESSIONS}
        />
      </>
    );
  }

  return (
    <Controller
      control={control}
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
  );
}

/**
 * The user's strategies the form may set up: those a grid can run along two numbers of where it
 * runs one, the one picked, and how picking one starts it.
 */
function useOwnStrategy(form: BacktestFormApi, gridded: boolean) {
  const [strategy, ownName] = useWatch({
    control: form.control,
    name: ["strategy", "own"],
  });

  const catalog = useQuery(strategiesQuery());

  const offered = (catalog.data?.strategies ?? []).filter(
    (each) => !gridded || Object.keys(each.params).length >= 2
  );

  const own =
    strategy === StrategyChoice.Own
      ? (offered.find((each) => each.name === ownName) ?? null)
      : null;

  /** Starts `name` from its numbers' initial values and its first two as the grid. */
  function pickOwn(name: string) {
    const picked = offered.find((each) => each.name === name);

    if (!picked) return;

    const numbers = ownNumbers(picked);
    const [down, across] = numbers.names;

    form.setValue("own", name);
    form.setValue(
      "params",
      Object.fromEntries(
        Object.entries(picked.params).map(([param, { initial }]) => [
          param,
          initial,
        ])
      )
    );

    if (down !== undefined && across !== undefined) {
      form.setValue("rows", numbers.axis(down));
      form.setValue("columns", numbers.axis(across));
    }

    form.clearErrors();
  }

  return {
    /** Picked, but not allowed to run as its files are now. */
    blocked: strategy === StrategyChoice.Own && !own?.allowed,
    ready: catalog.isSuccess,
    reach: catalog.data?.reach,
    offered,
    own,
    ownName,
    pickOwn,
  };
}

/** The numbers a grid over what is picked runs along; `null` for written rules. */
function gridNumbers(
  template: StrategyTemplate | null,
  own: StrategyEntry | null
) {
  if (own) return ownNumbers(own);

  return template ? templateNumbers(template) : null;
}

/**
 * The strategies the select offers: the templates, rules but in a grid, and the user's where any
 * fit, or with none written outside a grid, so they can write one.
 */
function strategyOptions(t: TFunction, gridded: boolean, owned: boolean) {
  return Object.values(StrategyChoice)
    .filter((id) => !gridded || id !== StrategyChoice.Rules)
    .filter((id) => id !== StrategyChoice.Own || owned || !gridded)
    .map((id) => ({
      id,
      label:
        id === StrategyChoice.Rules
          ? t("backtests.form.rules")
          : id === StrategyChoice.Own
            ? t("backtests.form.own")
            : t(`backtests.templates.${id}.name`),
    }));
}

/** What the strategy select says of what it picked. */
function strategyDescription(
  t: TFunction,
  template: StrategyTemplate | null,
  strategy: StrategyChoice
) {
  if (template) return t(`backtests.templates.${template}.description`);

  return strategy === StrategyChoice.Own
    ? t("backtests.form.own-hint")
    : t("backtests.form.rules-hint");
}

/**
 * Which of the user's strategies the form sets up, and the version to allow where it has not been;
 * with none written, a way to write one with the agent.
 */
function OwnStrategyPicker({
  symbol,
  owned,
}: {
  symbol: SymbolRef;
  owned: ReturnType<typeof useOwnStrategy>;
}) {
  const { t } = useTranslation();
  const { own, offered, ownName, reach, ready, pickOwn } = owned;

  if (ready && offered.length === 0) {
    return (
      <div className="flex flex-col items-start gap-2">
        <p className="text-xs text-muted">{t("backtests.form.own-none")}</p>
        <WriteStrategy symbol={symbol} />
      </div>
    );
  }

  return (
    <>
      <OptionSelect
        label={t("backtests.form.own-pick")}
        description={own?.description}
        options={offered.map((each) => ({ id: each.name, label: each.name }))}
        value={ownName}
        onChange={pickOwn}
      />
      {own && !own.allowed && reach ? (
        <StrategyAllow strategy={own} reach={reach} />
      ) : null}
    </>
  );
}

type BacktestFormApi = UseFormReturn<FormValues>;

// Fewer years may hold no window as long as the one picked.
function pickYearsOf(form: BacktestFormApi, years: number) {
  form.setValue("years", years);
  form.setValue("months", fittingMonths(years, form.getValues("months")));
}

/** Reads `next`'s bars, over the years its template reads where those it read are past what it reaches. */
function pickIntervalOf(
  form: BacktestFormApi,
  template: StrategyTemplate | null,
  next: Interval
) {
  const years = form.getValues("years");

  form.setValue("interval", next);

  if (yearChoices(next).includes(years)) return;

  pickYearsOf(
    form,
    template ? templateYears(template, next) : yearChoices(next)[0]
  );
}

/**
 * Sets `next` up: a template from its own numbers, years and grid, the first of the user's
 * strategies, or rules written out from the template shown.
 */
function pickStrategyOf(
  form: BacktestFormApi,
  {
    symbol,
    template,
    owned,
  }: {
    symbol: SymbolRef;
    template: StrategyTemplate | null;
    owned: ReturnType<typeof useOwnStrategy>;
  },
  next: StrategyChoice
) {
  const current = form.getValues();

  if (next === StrategyChoice.Own) {
    const [first] = owned.offered;

    if (first) owned.pickOwn(first.name);
  } else if (isEnumValue(StrategyTemplate, next)) {
    const { grid } = STRATEGY_TEMPLATES[next];

    form.setValue("params", initialSetup(next).params);
    pickYearsOf(form, templateYears(next, current.interval));
    form.setValue("rows", grid.rows);
    form.setValue("columns", grid.columns);
  } else if (template) {
    const shown = runSetup(symbol, current).strategy;

    // Written out from the template shown, so editing it starts from what it ran.
    if (!("name" in shown)) form.setValue("rules", writtenOut(shown));
  }

  form.setValue("strategy", next);
  form.clearErrors();
}

/** Whether what is picked cannot run as a grid: written rules, or a strategy with too few numbers. */
const strandedInGrid = (
  gridded: boolean,
  strategy: StrategyChoice,
  owned: ReturnType<typeof useOwnStrategy>
) =>
  gridded &&
  (strategy === StrategyChoice.Rules ||
    (strategy === StrategyChoice.Own && owned.ready && !owned.own));

/**
 * Sets a backtest up for `symbol`: a template with its numbers or rules written out, the interval
 * and years of bars it reads, where its out-of-sample stretch starts and what trades cost, in a
 * scan or a walk forward the grid of the template's numbers it runs, and for rolling windows how
 * long each runs and how far apart they start. It starts from what the panel ran last, and follows
 * it as it changes elsewhere.
 */
export function BacktestForm({
  symbol,
  mode,
  setup,
  isRunning,
  onSubmit,
}: {
  symbol: SymbolRef;
  mode: BacktestMode;
  setup: PanelSetup | undefined;
  isRunning: boolean;
  onSubmit: (request: BacktestRequest) => void;
}) {
  const { t } = useTranslation();
  const schema = useFormSchema(mode);

  const gridded =
    mode === BacktestMode.Scan || mode === BacktestMode.WalkForward;

  const form = useForm({
    resolver: zodResolver(schema),
    // NumberField commits on blur; revalidating then would move the button under the click.
    reValidateMode: "onSubmit",
    defaultValues: formValues(symbol, setup),
  });

  useEffect(() => {
    if (setup) form.reset(formValues(symbol, setup));
  }, [form, symbol, setup]);

  const [strategy, interval] = useWatch({
    control: form.control,
    name: ["strategy", "interval"],
  });

  const template = isEnumValue(StrategyTemplate, strategy) ? strategy : null;
  const owned = useOwnStrategy(form, gridded);
  const { own } = owned;
  const numbers = gridded ? gridNumbers(template, own) : null;

  const submit = form.handleSubmit((values) =>
    onSubmit(formRequest(mode, symbol, values))
  );

  const pickStrategy = (next: StrategyChoice) =>
    pickStrategyOf(form, { symbol, template, owned }, next);

  const leaveRules = useEffectEvent(() =>
    pickStrategy(StrategyTemplate.MovingAverageCross)
  );

  const stranded = strandedInGrid(gridded, strategy, owned);

  // A grid runs a template's numbers or a strategy's, so written rules give way to one in a scan or
  // a walk, and so does a strategy of the user's that takes too few numbers to run along.
  useEffect(() => {
    if (stranded) leaveRules();
  }, [stranded]);

  const pickYears = (years: number) => pickYearsOf(form, years);

  const pickInterval = (next: Interval) => pickIntervalOf(form, template, next);

  return (
    <Form
      validationBehavior="aria"
      // Its own width rather than the page's: beside the run it is narrow, above it wide.
      className="@container/setup flex flex-col gap-3"
      onSubmit={(event) => void submit(event)}>
      <OptionSelect
        label={t("backtests.form.strategy")}
        description={strategyDescription(t, template, strategy)}
        options={strategyOptions(t, gridded, owned.offered.length > 0)}
        value={strategy}
        onChange={pickStrategy}
      />
      {strategy === StrategyChoice.Own ? (
        <OwnStrategyPicker symbol={symbol} owned={owned} />
      ) : null}
      <StrategyFields
        control={form.control}
        choice={strategy}
        template={template}
        own={own}
      />
      {numbers ? <GridFields control={form.control} numbers={numbers} /> : null}
      <div className={FIELDS}>
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
              onChange={(next) => pickYears(Number(next))}
            />
          )}
        />
        <StretchFields control={form.control} mode={mode} />
        <NumberControl
          control={form.control}
          name="capital"
          label={t("backtests.form.capital")}
          param={CAPITAL}
        />
        <NumberControl
          control={form.control}
          name="commissionRate"
          label={t("backtests.form.commission")}
          param={COMMISSION}
          formatOptions={FINE_PERCENT}
        />
        <NumberControl
          control={form.control}
          name="slippageTicks"
          label={t("backtests.form.slippage")}
          param={SLIPPAGE}
        />
      </div>
      <Button
        type="submit"
        variant="secondary"
        isPending={isRunning}
        isDisabled={owned.blocked}>
        {t(`backtests.modes.${mode}.action`)}
      </Button>
    </Form>
  );
}
