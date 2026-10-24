import { useTranslation } from "react-i18next";

import {
  ExitParam,
  STRATEGY_TEMPLATES,
  TemplateParamName,
  templateParam,
} from "@solyx/core/strategy-templates";
import type { StrategyTemplate } from "@solyx/core/strategy-templates";
import { isEnumValue } from "@solyx/utils/is";

/** The numbers a grid over `template` may run along: its own, then its exits. */
export const gridParams = (template: StrategyTemplate) => [
  ...Object.keys(STRATEGY_TEMPLATES[template].params),
  ...Object.values(ExitParam),
];

/** Ten steps of `param` from a little below where it starts, or the template's own axis for it. */
export function defaultAxis(template: StrategyTemplate, param: string) {
  const { rows, columns } = STRATEGY_TEMPLATES[template].grid;
  const own = [rows, columns].find((axis) => axis.param === param);
  const bounds = templateParam(template, param);

  if (own) return own;

  if (!bounds) return { ...rows, param };

  const from = Math.max(bounds.min, bounds.initial - 4 * bounds.step);
  const to = Math.min(bounds.max, from + 9 * bounds.step);

  // Rounded so a step such as 0.01 adds up to the value a person would write.
  const round = (value: number) => Number(value.toFixed(6));

  return { param, from: round(from), to: round(to), step: bounds.step };
}

/** A template's numbers and exits by their names in the window's language, and their values as those numbers read. */
export function useParamWords() {
  const { t, i18n } = useTranslation();

  const percent = new Intl.NumberFormat(i18n.language, {
    style: "percent",
    maximumFractionDigits: 1,
  });

  const plain = new Intl.NumberFormat(i18n.language, {
    maximumFractionDigits: 2,
  });

  return {
    label(name: string) {
      if (isEnumValue(TemplateParamName, name)) {
        return t(`backtests.params.${name}`);
      }

      return isEnumValue(ExitParam, name) ? t(`backtests.form.${name}`) : name;
    },
    value: (name: string, value: number) =>
      isEnumValue(ExitParam, name)
        ? percent.format(value)
        : plain.format(value),
  };
}
