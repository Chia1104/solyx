import { Alert, Button, Table } from "@heroui/react";
import { useTranslation } from "react-i18next";

import type { BacktestSetup } from "@solyx/api/backtests";
import type { BacktestMetrics, BacktestResult } from "@solyx/core/backtest";

import { numberFormats } from "../market/number-formats.ts";

import { yearChoices } from "./backtest-years.ts";

/** A stretch of fewer trades than this says too little to conclude from, as the agent's backtest skill holds. */
const ENOUGH_TRADES = 20;

/** Below it, the rules' timing beat its bars put in a random order. */
const P_VALUE_LINE = 0.05;

/** The stretches a run is measured over, in-sample first. */
const Stretch = {
  InSample: "inSample",
  OutOfSample: "outOfSample",
  All: "all",
} as const;

type Stretch = (typeof Stretch)[keyof typeof Stretch];

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

/** Each stretch's figures beside holding the listing through it, in-sample, out of sample and whole. */
function MetricsTable({ result }: { result: BacktestResult }) {
  const { t } = useTranslation();
  const formatted = useMetricFormat();

  const stretches = Object.values(Stretch).flatMap((stretch) => {
    const metrics = result[stretch];

    return metrics ? [{ stretch, metrics }] : [];
  });

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

/**
 * What keeps a run from saying much, each as data: stretches of too few trades, out-of-sample
 * timing no better than chance, and an out-of-sample record behind holding the listing.
 */
function Warnings({
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
  const { inSample, outOfSample } = result;
  const warnings: { id: string; text: string; years?: number }[] = [];

  const thin = [
    { stretch: Stretch.InSample, metrics: inSample },
    { stretch: Stretch.OutOfSample, metrics: outOfSample },
  ].flatMap(({ stretch, metrics }) =>
    metrics && metrics.trades < ENOUGH_TRADES
      ? [
          t("backtests.report.warnings.stretch-trades", {
            stretch: t(`backtests.report.stretches.${stretch}`),
            count: metrics.trades,
          }),
        ]
      : []
  );

  if (thin.length > 0) {
    warnings.push({
      id: "few-trades",
      text: t("backtests.report.warnings.few-trades", {
        stretches: thin.join(t("backtests.report.warnings.separator")),
        enough: ENOUGH_TRADES,
      }),
      years: yearChoices(setup.interval).find((years) => years > setup.years),
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
              {years === undefined ? null : (
                <Button
                  size="sm"
                  variant="tertiary"
                  onPress={() => onReadLonger(years)}>
                  {t("backtests.report.warnings.read-longer", { count: years })}
                </Button>
              )}
            </li>
          ))}
        </ul>
      </Alert.Content>
    </Alert>
  );
}

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

  const fine = new Intl.NumberFormat(i18n.language, {
    style: "percent",
    maximumFractionDigits: 4,
  });

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
      <Warnings setup={setup} result={result} onReadLonger={onReadLonger} />
      <MetricsTable result={result} />
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
