import { useMemo } from "react";

import { Table } from "@heroui/react";
import { useTranslation } from "react-i18next";

import { ENOUGH_TRADES } from "@solyx/core/backtest";
import type {
  BacktestMetrics,
  RollingResult,
  RollingSpread,
  RollingSummary,
} from "@solyx/core/backtest";

import { usePaletteColors } from "../../app/theme.ts";
import { LINE_COLORS } from "../market/chart-palette.ts";
import { numberFormats } from "../market/number-formats.ts";

import { ReturnChart } from "./equity-chart.tsx";
import { RunWarnings } from "./run-warnings.tsx";
import type { RunWarning } from "./run-warnings.tsx";

/** Below it, overlapping windows stand for too few periods apart for their shares to say much. */
const FEW_APART = 3;

const NUMBER = "text-end tabular-nums";

/** What keeps the windows from saying much: too few trades in some, too few apart, holding ahead. */
function useRollingWarnings(summary: RollingSummary) {
  const { t, i18n } = useTranslation();
  const format = numberFormats(i18n.language);
  const warnings: RunWarning[] = [];

  if (summary.thin > 0) {
    warnings.push({
      id: "thin",
      text: t("backtests.rolling.warnings.thin", {
        count: summary.thin,
        total: summary.windows,
        enough: ENOUGH_TRADES,
      }),
    });
  }

  if (summary.apart < FEW_APART) {
    warnings.push({
      id: "few-apart",
      text: t("backtests.rolling.warnings.few-apart", {
        count: summary.apart,
      }),
    });
  }

  if (summary.excess.median < 0) {
    warnings.push({
      id: "behind-holding",
      text: t("backtests.rolling.warnings.behind-holding", {
        excess: format.percentChange.format(summary.excess.median),
      }),
    });
  }

  return warnings;
}

/** The windows' returns, holding's and the first less the second, at their tenth, middle and ninetieth percentiles. */
function SpreadTable({ summary }: { summary: RollingSummary }) {
  const { t, i18n } = useTranslation();
  const format = numberFormats(i18n.language);

  const rows: { id: string; label: string; spread: RollingSpread }[] = [
    {
      id: "returns",
      label: t("backtests.rolling.spreads.returns"),
      spread: summary.returns,
    },
    {
      id: "holding",
      label: t("backtests.rolling.spreads.holding"),
      spread: summary.holding,
    },
    {
      id: "excess",
      label: t("backtests.rolling.spreads.excess"),
      spread: summary.excess,
    },
  ];

  return (
    <Table variant="secondary">
      <Table.ScrollContainer>
        <Table.Content
          aria-label={t("backtests.rolling.spread-label")}
          className="whitespace-nowrap">
          <Table.Header>
            <Table.Column isRowHeader>
              {t("backtests.report.metric")}
            </Table.Column>
            <Table.Column className={NUMBER}>
              {t("backtests.rolling.low")}
            </Table.Column>
            <Table.Column className={NUMBER}>
              {t("backtests.rolling.median")}
            </Table.Column>
            <Table.Column className={NUMBER}>
              {t("backtests.rolling.high")}
            </Table.Column>
          </Table.Header>
          <Table.Body>
            {rows.map(({ id, label, spread }) => (
              <Table.Row key={id} id={id}>
                <Table.Cell>{label}</Table.Cell>
                <Table.Cell className={NUMBER}>
                  {format.percentChange.format(spread.low)}
                </Table.Cell>
                <Table.Cell className={NUMBER}>
                  {format.percentChange.format(spread.median)}
                </Table.Cell>
                <Table.Cell className={NUMBER}>
                  {format.percentChange.format(spread.high)}
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Content>
      </Table.ScrollContainer>
    </Table>
  );
}

/** Each window's return and holding's, drawn at the session it started on. */
function StartsChart({
  months,
  windows,
}: {
  months: number;
  windows: BacktestMetrics[];
}) {
  const { t } = useTranslation();
  const colors = usePaletteColors();

  // A return reads as the value of 1 put in at the window's start.
  const lines = useMemo(
    () => [
      {
        id: "holding",
        label: t("backtests.report.holding"),
        color: LINE_COLORS.holding,
        dashed: true,
        capital: 1,
        values: windows.map(({ from, buyAndHold }) => ({
          date: from,
          value: 1 + buyAndHold,
        })),
      },
      {
        id: "strategy",
        label: t("backtests.report.strategy"),
        color: colors.accent,
        capital: 1,
        values: windows.map(({ from, totalReturn }) => ({
          date: from,
          value: 1 + totalReturn,
        })),
      },
    ],
    [t, colors.accent, windows]
  );

  return (
    <ReturnChart
      title={t("backtests.rolling.chart", { count: months })}
      lines={lines}
      split={null}
    />
  );
}

/**
 * Rolling windows' record: what keeps them from saying much, the share of starts that beat holding
 * and that gained, how their returns spread beside holding's, each start's return against holding
 * through it, and every window's own figures.
 */
export function RollingReport({ rolling }: { rolling: RollingResult }) {
  const { t, i18n } = useTranslation();
  const format = numberFormats(i18n.language);
  const { summary, windows } = rolling;
  const warnings = useRollingWarnings(summary);

  const headlines = [
    {
      id: "beat-holding",
      label: t("backtests.rolling.headlines.beat-holding"),
      value: format.percent.format(summary.beatHolding),
    },
    {
      id: "gained",
      label: t("backtests.rolling.headlines.gained"),
      value: format.percent.format(summary.gained),
    },
    {
      id: "worst-drawdown",
      label: t("backtests.rolling.headlines.worst-drawdown"),
      value: format.fineShare.format(summary.worstDrawdown),
    },
  ];

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <p className="text-xs text-muted tabular-nums">
        {t("backtests.rolling.span", {
          count: summary.windows,
          months: t("backtests.rolling.months-option", {
            count: rolling.months,
          }),
          from: windows[0].from,
          to: windows[windows.length - 1].from,
          interval: t(`chart.intervals.${rolling.interval}`),
          apart: summary.apart,
        })}
      </p>
      <RunWarnings warnings={warnings} />
      <dl className="flex flex-wrap gap-x-8 gap-y-2">
        {headlines.map(({ id, label, value }) => (
          <div key={id} className="flex flex-col">
            <dt className="text-xs text-muted">{label}</dt>
            <dd className="text-2xl font-medium tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      <SpreadTable summary={summary} />
      <StartsChart months={rolling.months} windows={windows} />
      <section className="flex flex-col gap-1.5">
        <h4 className="text-xs font-medium text-muted">
          {t("backtests.rolling.windows")}
        </h4>
        <ol className="flex max-h-64 flex-col gap-1 overflow-y-auto pe-1 text-xs tabular-nums">
          {windows.map((window) => (
            <li
              key={window.from}
              className="flex flex-wrap justify-between gap-x-3">
              <span>
                {window.from} – {window.to}
              </span>
              <span className="text-muted">
                {t("backtests.rolling.window", {
                  total: format.percentChange.format(window.totalReturn),
                  holding: format.percentChange.format(window.buyAndHold),
                  drawdown: format.fineShare.format(window.maxDrawdown),
                  count: window.trades,
                })}
              </span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
