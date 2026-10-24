import { Table } from "@heroui/react";
import { useTranslation } from "react-i18next";

import type { BacktestMetrics, BacktestStretches } from "@solyx/core/backtest";

import { numberFormats } from "../market/number-formats.ts";

/** The stretches a run is measured over, in-sample first. */
export const Stretch = {
  InSample: "inSample",
  OutOfSample: "outOfSample",
  All: "all",
} as const;

export type Stretch = (typeof Stretch)[keyof typeof Stretch];

/** One stretch's figures, under the name a table heads its column with. */
export interface StretchFigures {
  stretch: Stretch;
  metrics: BacktestMetrics;
}

/** The stretches a run measured, in-sample first, leaving out those it has none of. */
export const runStretches = (run: BacktestStretches): StretchFigures[] =>
  Object.values(Stretch).flatMap((stretch) => {
    const metrics = run[stretch];

    return metrics ? [{ stretch, metrics }] : [];
  });

/** The figures each stretch shows, in their rows' order. */
const Metric = {
  TotalReturn: "totalReturn",
  BuyAndHold: "buyAndHold",
  AnnualReturn: "annualReturn",
  MaxDrawdown: "maxDrawdown",
  BuyAndHoldDrawdown: "buyAndHoldDrawdown",
  Sharpe: "sharpe",
  PValue: "pValue",
  Trades: "trades",
  WinRate: "winRate",
  PayoffRatio: "payoffRatio",
  Exposure: "exposure",
} as const;

type Metric = (typeof Metric)[keyof typeof Metric];

const NUMBER = "text-end tabular-nums";

function useMetricFormat() {
  const { i18n } = useTranslation();
  const format = numberFormats(i18n.language);

  return (metric: Metric, metrics: BacktestMetrics) => {
    const value = metrics[metric];

    if (value === null) return "—";

    switch (metric) {
      case Metric.TotalReturn:
      case Metric.BuyAndHold:
      case Metric.AnnualReturn:
        return format.percentChange.format(value);
      case Metric.MaxDrawdown:
      case Metric.BuyAndHoldDrawdown:
      case Metric.WinRate:
      case Metric.Exposure:
        return format.fineShare.format(value);
      case Metric.Trades:
        return format.amount.format(value);
      default:
        return format.indicator.format(value);
    }
  };
}

/** Each stretch's figures beside holding the listing through it, a column a stretch. */
export function MetricsTable({ stretches }: { stretches: StretchFigures[] }) {
  const { t } = useTranslation();
  const formatted = useMetricFormat();

  return (
    <Table variant="secondary">
      <Table.ScrollContainer>
        <Table.Content
          aria-label={t("backtests.report.metrics-label")}
          className="whitespace-nowrap">
          <Table.Header>
            <Table.Column isRowHeader>
              {t("backtests.report.metric")}
            </Table.Column>
            {stretches.map(({ stretch, metrics }) => (
              <Table.Column key={stretch} className={NUMBER}>
                <span className="flex flex-col items-end">
                  {t(`backtests.report.stretches.${stretch}`)}
                  <span className="text-xs font-normal text-muted">
                    {metrics.from} – {metrics.to}
                  </span>
                </span>
              </Table.Column>
            ))}
          </Table.Header>
          <Table.Body>
            {Object.values(Metric).map((metric) => (
              <Table.Row key={metric} id={metric}>
                <Table.Cell>
                  {t(`backtests.report.metrics.${metric}`)}
                </Table.Cell>
                {stretches.map(({ stretch, metrics }) => (
                  <Table.Cell key={stretch} className={NUMBER}>
                    {formatted(metric, metrics)}
                  </Table.Cell>
                ))}
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Content>
      </Table.ScrollContainer>
    </Table>
  );
}
