import { scaleLinear } from "d3-scale";
import { useTranslation } from "react-i18next";

import type { WalkForwardSetup } from "@solyx/api/backtests";
import type { WalkForwardResult } from "@solyx/core/backtest";
import { axisValues } from "@solyx/core/strategy-templates";
import { dateEpochDay } from "@solyx/utils/date";

import { usePaletteColors } from "../../app/theme.ts";
import { faded } from "../market/chart-palette.ts";
import { numberFormats } from "../market/number-formats.ts";

import { useParamWords } from "./backtest-params.ts";
import { EquityChart } from "./equity-chart.tsx";
import { RunWarnings, useStretchWarnings } from "./run-warnings.tsx";
import { MetricsTable, Stretch } from "./stretch-figures.tsx";

/** Below it, the picks did far worse after their training than in it. */
const FITTED_LINE = 0.5;

/**
 * A walk forward's record: what keeps it from saying much, its tests run as one against holding
 * the listing, how much of its training's Sharpe ratio it kept, and each window's training, test
 * and pick on one time line.
 */
export function WalkReport({
  setup,
  walk,
}: {
  setup: WalkForwardSetup;
  walk: WalkForwardResult;
}) {
  const { t, i18n } = useTranslation();
  const colors = usePaletteColors();
  const words = useParamWords();
  const format = numberFormats(i18n.language);
  const stretchWarnings = useStretchWarnings();
  const rows = axisValues(setup.rows);
  const columns = axisValues(setup.columns);
  const stretch = { stretch: Stretch.OutOfSample, metrics: walk.outOfSample };
  const warnings = stretchWarnings([stretch], walk.outOfSample);

  if (walk.efficiency === null) {
    warnings.push({ id: "no-picks", text: t("backtests.walk.no-picks") });
  } else if (walk.efficiency < FITTED_LINE) {
    warnings.push({
      id: "fitted",
      text: t("backtests.walk.fitted", {
        efficiency: format.percent.format(walk.efficiency),
      }),
    });
  }

  const first = walk.windows[0]?.train.from ?? walk.outOfSample.from;
  const last = walk.windows.at(-1)?.test.to ?? walk.outOfSample.to;

  const x = scaleLinear()
    .domain([dateEpochDay(first), dateEpochDay(last)])
    .range([0, 100]);

  const span = (from: string, to: string) => ({
    left: `${x(dateEpochDay(from))}%`,
    width: `${Math.max(x(dateEpochDay(to)) - x(dateEpochDay(from)), 0.5)}%`,
  });

  const pick = (cell: number | null) =>
    cell === null
      ? t("backtests.walk.no-pick")
      : t("backtests.scan.cell", {
          row: words.label(setup.rows.param),
          rowValue: words.value(
            setup.rows.param,
            rows[Math.floor(cell / columns.length)]
          ),
          column: words.label(setup.columns.param),
          columnValue: words.value(
            setup.columns.param,
            columns[cell % columns.length]
          ),
        });

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <p className="text-xs text-muted tabular-nums">
        {t("backtests.walk.span", {
          count: walk.windows.length,
          from: walk.outOfSample.from,
          to: walk.outOfSample.to,
          interval: t(`chart.intervals.${walk.interval}`),
        })}
      </p>
      <RunWarnings warnings={warnings} />
      <p className="flex items-baseline gap-2">
        <span className="text-2xl font-medium tabular-nums">
          {walk.efficiency === null
            ? "—"
            : format.indicator.format(walk.efficiency)}
        </span>
        <span className="text-xs text-muted">
          {t("backtests.walk.efficiency")}
        </span>
      </p>
      <MetricsTable stretches={[stretch]} />
      <EquityChart
        capital={walk.capital}
        equity={walk.equity}
        holding={walk.holding}
        split={null}
      />
      <section className="flex flex-col gap-1.5">
        <h4 className="flex items-center gap-4 text-xs font-medium text-muted">
          {t("backtests.walk.windows")}
          <span className="flex items-center gap-1.5 font-normal">
            <span
              aria-hidden
              className="h-2 w-4 rounded-sm"
              style={{ background: faded(colors.muted, 0.35) }}
            />
            {t("backtests.walk.training")}
          </span>
          <span className="flex items-center gap-1.5 font-normal">
            <span
              aria-hidden
              className="h-2 w-4 rounded-sm"
              style={{ background: colors.accent }}
            />
            {t("backtests.walk.testing")}
          </span>
        </h4>
        <ol className="flex max-h-64 flex-col gap-1 overflow-y-auto pe-1">
          {walk.windows.map((window) => (
            <li
              key={window.test.from}
              className="grid grid-cols-[minmax(0,1fr)_minmax(0,18rem)] items-center gap-3 text-xs tabular-nums">
              <span
                className="relative h-3"
                aria-label={t("backtests.walk.window", {
                  trainFrom: window.train.from,
                  trainTo: window.train.to,
                  testFrom: window.test.from,
                  testTo: window.test.to,
                })}
                role="img">
                <span
                  className="absolute inset-y-0 rounded-sm"
                  style={{
                    ...span(window.train.from, window.train.to),
                    background: faded(colors.muted, 0.35),
                  }}
                />
                <span
                  className="absolute inset-y-0 rounded-sm"
                  style={{
                    ...span(window.test.from, window.test.to),
                    background: colors.accent,
                  }}
                />
              </span>
              <span className="truncate text-muted">
                {pick(window.cell)}
                {window.trainSharpe === null
                  ? null
                  : ` · ${t("backtests.walk.train-sharpe", {
                      sharpe: format.indicator.format(window.trainSharpe),
                    })}`}
              </span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
