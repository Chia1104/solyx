import { useTranslation } from "react-i18next";

import type { BacktestSetup } from "@solyx/api/backtests";
import type { BacktestResult } from "@solyx/core/backtest";

import { numberFormats } from "../market/number-formats.ts";

import { yearChoices } from "./backtest-years.ts";
import { RunWarnings, useStretchWarnings } from "./run-warnings.tsx";
import { MetricsTable, Stretch, runStretches } from "./stretch-figures.tsx";

/**
 * A run's record: the bars it read and where its out-of-sample stretch starts, what keeps it from
 * saying much, each stretch's figures against holding the listing, and what its trades cost.
 */
export function BacktestReport({
  setup,
  result,
  onReadLonger,
}: {
  setup: BacktestSetup;
  result: BacktestResult;
  onReadLonger: (years: number) => void;
}) {
  const { t, i18n } = useTranslation();
  const format = numberFormats(i18n.language);
  const stretchWarnings = useStretchWarnings();
  const stretches = runStretches(result);

  const fine = new Intl.NumberFormat(i18n.language, {
    style: "percent",
    maximumFractionDigits: 4,
  });

  // The whole span adds nothing to how thin its halves are.
  const warnings = stretchWarnings(
    stretches.filter(({ stretch }) => stretch !== Stretch.All),
    result.outOfSample
  ).map((warning) =>
    warning.id === "few-trades"
      ? {
          ...warning,
          years: yearChoices(setup.interval).find(
            (years) => years > setup.years
          ),
        }
      : warning
  );

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <p className="text-xs text-muted tabular-nums">
        {t("backtests.report.span", {
          from: result.all.from,
          to: result.all.to,
          bars: format.amount.format(result.bars),
          interval: t(`chart.intervals.${result.interval}`),
        })}
        {result.outOfSample
          ? ` · ${t("backtests.report.split", { date: result.outOfSample.from })}`
          : null}
      </p>
      <RunWarnings warnings={warnings} onReadLonger={onReadLonger} />
      <MetricsTable stretches={stretches} />
      <p className="text-xs text-muted tabular-nums">
        {t("backtests.report.costs", {
          commission: fine.format(result.costs.commissionRate),
          minimum: format.amount.format(result.costs.minCommission),
          tax: fine.format(result.costs.sellTaxRate),
          count: result.costs.slippageTicks,
        })}
      </p>
    </div>
  );
}
