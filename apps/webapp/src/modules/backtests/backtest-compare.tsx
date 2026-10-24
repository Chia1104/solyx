import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import type { BacktestRecord } from "@solyx/api/backtests";
import { symbolLabel } from "@solyx/core/market";

import { usePaletteColors } from "../../app/theme.ts";
import { LoadError } from "../../components/load-error.tsx";
import { LoadingState } from "../../components/loading-state.tsx";
import { LINE_COLORS } from "../market/chart-palette.ts";

import { useRecordWords } from "./backtest-history.tsx";
import { ReturnChart } from "./equity-chart.tsx";
import { compareQuery } from "./history-query.ts";
import { FiguresTable } from "./stretch-figures.tsx";

/**
 * Single runs kept in the history run again side by side over the bars as they are now: their
 * returns on one chart and their out-of-sample figures, or the whole span's where they have no
 * split, a column each.
 */
export function BacktestCompare({ records }: { records: BacktestRecord[] }) {
  const { t } = useTranslation();
  const colors = usePaletteColors();
  const words = useRecordWords();
  const ids = records.map(({ id }) => id);
  const { data, error, refetch } = useQuery(compareQuery(ids));

  const palette = [
    colors.accent,
    LINE_COLORS.slow,
    LINE_COLORS.vwap,
    LINE_COLORS.short,
  ];

  if (records.length === 0) {
    return <p className="text-sm text-muted">{t("backtests.compare.idle")}</p>;
  }

  if (error) return <LoadError error={error} onRetry={() => void refetch()} />;

  if (!data) return <LoadingState />;

  const runs = data.flatMap(({ id, result }, index) => {
    const record = records.find((each) => each.id === id);

    return record
      ? [
          {
            id,
            label: `${index + 1}. ${symbolLabel(record.request.setup.symbol)} ${words.title(record)}`,
            color: palette[index % palette.length],
            result,
          },
        ]
      : [];
  });

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <ol className="flex flex-col gap-1 text-xs">
        {runs.map(({ id, label, color }) => (
          <li key={id} className="flex items-center gap-2">
            <span
              aria-hidden
              className="h-0.5 w-4 shrink-0 rounded-full"
              style={{ background: color }}
            />
            <span className="truncate">{label}</span>
          </li>
        ))}
      </ol>
      <ReturnChart
        title={t("backtests.compare.returns")}
        split={null}
        lines={runs.map(({ id, color, result }, index) => ({
          id,
          label: `${index + 1}`,
          color,
          capital: result.capital,
          values: result.equity,
        }))}
      />
      <FiguresTable
        columns={runs.map(({ id, result }, index) => ({
          id,
          title: t(
            result.outOfSample
              ? "backtests.compare.out-of-sample"
              : "backtests.compare.all",
            { index: index + 1 }
          ),
          metrics: result.outOfSample ?? result.all,
        }))}
      />
      <p className="text-xs text-muted">{t("backtests.compare.again")}</p>
    </div>
  );
}
