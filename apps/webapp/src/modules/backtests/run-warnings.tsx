import { Alert, Button } from "@heroui/react";
import { useTranslation } from "react-i18next";

import { ENOUGH_TRADES } from "@solyx/core/backtest";
import type { BacktestMetrics } from "@solyx/core/backtest";

import { numberFormats } from "../market/number-formats.ts";

import type { StretchFigures } from "./stretch-figures.tsx";

/** Below it, the rules' timing beat its bars put in a random order. */
const P_VALUE_LINE = 0.05;

/** What keeps a run from saying much, with the years to read instead where reading further back would help. */
export interface RunWarning {
  id: string;
  text: string;
  years?: number;
}

/**
 * What keeps stretches from saying much, each as words: those of too few trades, out-of-sample
 * timing no better than chance, and an out-of-sample record behind holding the listing.
 */
export function useStretchWarnings() {
  const { t, i18n } = useTranslation();
  const format = numberFormats(i18n.language);

  return (
    stretches: StretchFigures[],
    outOfSample: BacktestMetrics | null
  ): RunWarning[] => {
    const warnings: RunWarning[] = [];

    const thin = stretches
      .filter(({ metrics }) => metrics.trades < ENOUGH_TRADES)
      .map(({ stretch, metrics }) =>
        t("backtests.report.warnings.stretch-trades", {
          stretch: t(`backtests.report.stretches.${stretch}`),
          count: metrics.trades,
        })
      );

    if (thin.length > 0) {
      warnings.push({
        id: "few-trades",
        text: t("backtests.report.warnings.few-trades", {
          stretches: thin.join(t("backtests.report.warnings.separator")),
          enough: ENOUGH_TRADES,
        }),
      });
    }

    const pValue = outOfSample?.pValue;

    if (pValue === null) {
      warnings.push({
        id: "untested",
        text: t("backtests.report.warnings.untested"),
      });
    } else if (pValue !== undefined && pValue >= P_VALUE_LINE) {
      warnings.push({
        id: "chance",
        text: t("backtests.report.warnings.chance", {
          p: format.indicator.format(pValue),
        }),
      });
    }

    if (outOfSample && outOfSample.totalReturn < outOfSample.buyAndHold) {
      warnings.push({
        id: "behind-holding",
        text: t("backtests.report.warnings.behind-holding", {
          strategy: format.percentChange.format(outOfSample.totalReturn),
          holding: format.percentChange.format(outOfSample.buyAndHold),
        }),
      });
    }

    return warnings;
  };
}

/** What keeps a run from saying much, offering to read further back where that would help. */
export function RunWarnings({
  warnings,
  onReadLonger,
}: {
  warnings: RunWarning[];
  onReadLonger?: (years: number) => void;
}) {
  const { t } = useTranslation();

  if (warnings.length === 0) return null;

  return (
    <Alert status="warning">
      <Alert.Indicator />
      <Alert.Content className="min-w-0 gap-1">
        <Alert.Title>{t("backtests.report.warnings.title")}</Alert.Title>
        <ul className="flex flex-col gap-1 text-sm">
          {warnings.map(({ id, text, years }) => (
            <li key={id} className="flex flex-wrap items-center gap-x-2">
              {text}
              {years === undefined || !onReadLonger ? null : (
                <Button
                  size="sm"
                  variant="tertiary"
                  onPress={() => onReadLonger(years)}>
                  {t("backtests.report.warnings.read-longer", {
                    count: years,
                  })}
                </Button>
              )}
            </li>
          ))}
        </ul>
      </Alert.Content>
    </Alert>
  );
}
