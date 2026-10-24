import { Label, NumberField } from "@heroui/react";
import { useTranslation } from "react-i18next";

import { ExitParam, templateParam } from "@solyx/core/strategy-templates";
import type {
  GridAxis,
  StrategyTemplate,
} from "@solyx/core/strategy-templates";
import { isEnumValue } from "@solyx/utils/is";

import { OptionSelect } from "../../components/option-select.tsx";

import { defaultAxis, gridParams, useParamWords } from "./backtest-params.ts";

/** One of an axis's numbers, snapped to the steps of the number it runs along. */
function AxisNumber({
  label,
  value,
  min,
  max,
  step,
  percent,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  percent: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <NumberField
      minValue={min}
      maxValue={max}
      step={step}
      formatOptions={
        percent
          ? { style: "percent", maximumFractionDigits: 1 }
          : { maximumFractionDigits: 4 }
      }
      value={value}
      onChange={(next) => onChange(next ?? Number.NaN)}>
      <Label>{label}</Label>
      <NumberField.Group>
        <NumberField.Input className="text-center tabular-nums" />
      </NumberField.Group>
    </NumberField>
  );
}

/**
 * The number a grid runs along one way, and its values: from, to and by. Picking another number
 * starts it from that number's own range.
 */
export function GridAxisFields({
  label,
  template,
  axis,
  onChange,
}: {
  label: string;
  template: StrategyTemplate;
  axis: GridAxis;
  onChange: (axis: GridAxis) => void;
}) {
  const { t } = useTranslation();
  const words = useParamWords();
  const bounds = templateParam(template, axis.param);

  if (!bounds) return null;

  const percent = isEnumValue(ExitParam, axis.param);
  const span = bounds.max - bounds.min;

  return (
    <fieldset className="grid grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))] items-end gap-2">
      <OptionSelect
        label={label}
        options={gridParams(template).map((id) => ({
          id,
          label: words.label(id),
        }))}
        value={axis.param}
        onChange={(param) => onChange(defaultAxis(template, param))}
      />
      <AxisNumber
        label={t("backtests.grid.from")}
        value={axis.from}
        min={bounds.min}
        max={bounds.max}
        step={bounds.step}
        percent={percent}
        onChange={(from) => onChange({ ...axis, from })}
      />
      <AxisNumber
        label={t("backtests.grid.to")}
        value={axis.to}
        min={bounds.min}
        max={bounds.max}
        step={bounds.step}
        percent={percent}
        onChange={(to) => onChange({ ...axis, to })}
      />
      <AxisNumber
        label={t("backtests.grid.step")}
        value={axis.step}
        min={bounds.step}
        max={span}
        step={bounds.step}
        percent={percent}
        onChange={(step) => onChange({ ...axis, step })}
      />
    </fieldset>
  );
}

/** How big a grid is, or why it would not run. */
export function GridSummary({
  cells,
  series,
  maxSeries,
  problem,
}: {
  cells: number;
  series: number;
  maxSeries: number;
  problem: string | undefined;
}) {
  const { t } = useTranslation();

  if (problem) {
    return (
      <p role="alert" className="text-xs text-danger">
        {problem}
      </p>
    );
  }

  return (
    <p className="text-xs text-muted tabular-nums">
      {t("backtests.grid.size", { count: cells, series, max: maxSeries })}
    </p>
  );
}
