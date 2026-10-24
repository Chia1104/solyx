import { useState } from "react";

import { Button, Switch, cn } from "@heroui/react";
import { scaleLinear } from "d3-scale";
import { useTranslation } from "react-i18next";

import type { BacktestSetup, ScanSetup } from "@solyx/api/backtests";
import type { BacktestScan, BacktestStretches } from "@solyx/core/backtest";
import { axisValues, gridSetups } from "@solyx/core/strategy-templates";

import { usePaletteColors } from "../../app/theme.ts";
import { ChartMark } from "../../components/chart-mark.tsx";
import { faded } from "../market/chart-palette.ts";
import { numberFormats } from "../market/number-formats.ts";

import { useParamWords } from "./backtest-params.ts";
import { RunWarnings } from "./run-warnings.tsx";
import type { RunWarning } from "./run-warnings.tsx";
import { MetricsTable, Stretch } from "./stretch-figures.tsx";
import type { StretchFigures } from "./stretch-figures.tsx";

/** How faint the weakest cell and how deep the strongest is drawn. */
const SHADE = { least: 0.08, most: 0.85 };

/** A cell's name in the window's language: the value of each number it sets. */
function useCellName(setup: ScanSetup) {
  const { t } = useTranslation();
  const words = useParamWords();
  const rows = axisValues(setup.rows);
  const columns = axisValues(setup.columns);

  return (cell: number) =>
    t("backtests.scan.cell", {
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
}

/** What a cell's tooltip says of its in-sample stretch. */
function CellTooltip({
  name,
  figures,
}: {
  name: string;
  figures: BacktestStretches | undefined;
}) {
  const { t, i18n } = useTranslation();
  const format = numberFormats(i18n.language);
  const metrics = figures?.inSample;

  return (
    <>
      <span className="font-medium">{name}</span>
      {metrics ? (
        <>
          <span>
            {t("backtests.scan.cell-sharpe", {
              sharpe:
                metrics.sharpe === null
                  ? "—"
                  : format.indicator.format(metrics.sharpe),
            })}
          </span>
          <span>
            {t("backtests.scan.cell-figures", {
              total: format.percentChange.format(metrics.totalReturn),
              trades: metrics.trades,
              drawdown: format.fineShare.format(metrics.maxDrawdown),
            })}
          </span>
        </>
      ) : null}
    </>
  );
}

/**
 * Each cell's in-sample Sharpe ratio, a row of the grid a value of one number and a column a
 * value of the other, the plateau outlined and the cell picked marked; pressing a cell picks it.
 */
function ScanHeatMap({
  setup,
  scan,
  picked,
  onPick,
}: {
  setup: ScanSetup;
  scan: BacktestScan;
  picked: number;
  onPick: (cell: number) => void;
}) {
  const { t, i18n } = useTranslation();
  const colors = usePaletteColors();
  const words = useParamWords();
  const format = numberFormats(i18n.language);
  const cellName = useCellName(setup);
  const rows = axisValues(setup.rows);
  const columns = axisValues(setup.columns);
  const sharpe = (cell: number) => scan.cells[cell]?.inSample?.sharpe ?? null;
  const known = scan.cells.flatMap((_, cell) => sharpe(cell) ?? []);

  const shade = scaleLinear()
    .domain([Math.min(...known), Math.max(...known)])
    .range([SHADE.least, SHADE.most])
    .clamp(true);

  const mark = (cell: number) => {
    const value = sharpe(cell);

    return (
      <span key={cell} className="relative h-8">
        <ChartMark
          label={cellName(cell)}
          pressed={cell === picked}
          onPress={() => onPick(cell)}
          className={cn(
            "flex items-center justify-center",
            cell === scan.plateau?.cell && "ring-2 ring-foreground ring-inset",
            cell === picked && "outline-2 outline-accent"
          )}
          style={{
            background:
              value === null ? undefined : faded(colors.accent, shade(value)),
          }}
          tooltip={
            <CellTooltip name={cellName(cell)} figures={scan.cells[cell]} />
          }>
          {value === null ? "—" : format.indicator.format(value)}
        </ChartMark>
      </span>
    );
  };

  return (
    <figure className="flex flex-col gap-1.5">
      <figcaption className="text-xs text-muted">
        {t("backtests.scan.heat-map", {
          row: words.label(setup.rows.param),
          column: words.label(setup.columns.param),
        })}
      </figcaption>
      <div
        className="grid gap-0.5 overflow-x-auto text-xs tabular-nums"
        style={{
          gridTemplateColumns: `auto repeat(${columns.length}, minmax(2.75rem, 1fr))`,
        }}>
        <span />
        {columns.map((value) => (
          <span key={value} className="text-center text-muted">
            {words.value(setup.columns.param, value)}
          </span>
        ))}
        {rows.flatMap((rowValue, row) => [
          <span
            key={`row-${rowValue}`}
            className="flex items-center justify-end pe-1.5 text-muted">
            {words.value(setup.rows.param, rowValue)}
          </span>,
          ...columns.map((_, column) => mark(row * columns.length + column)),
        ])}
      </div>
    </figure>
  );
}

/**
 * The cell picked in full: its in-sample figures, its out-of-sample ones once asked for, and a
 * button that runs it alone.
 */
function PickedCell({
  name,
  plateau,
  figures,
  onRun,
}: {
  name: string;
  plateau: boolean;
  figures: BacktestStretches;
  onRun: () => void;
}) {
  const { t } = useTranslation();
  const [outOfSample, setOutOfSample] = useState(false);
  const stretches: StretchFigures[] = [];

  if (figures.inSample) {
    stretches.push({ stretch: Stretch.InSample, metrics: figures.inSample });
  }

  if (outOfSample && figures.outOfSample) {
    stretches.push({
      stretch: Stretch.OutOfSample,
      metrics: figures.outOfSample,
    });
  }

  return (
    <section className="flex flex-col gap-2">
      <h4 className="flex flex-wrap items-baseline gap-x-2 text-sm font-medium">
        {name}
        {plateau ? (
          <span className="text-xs font-normal text-muted">
            {t("backtests.scan.plateau")}
          </span>
        ) : null}
      </h4>
      <MetricsTable stretches={stretches} />
      <div className="flex flex-wrap items-center gap-3">
        <Switch size="sm" isSelected={outOfSample} onChange={setOutOfSample}>
          <Switch.Content>
            <Switch.Control>
              <Switch.Thumb />
            </Switch.Control>
            <span className="text-xs">
              {t("backtests.scan.show-out-of-sample")}
            </span>
          </Switch.Content>
        </Switch>
        <Button size="sm" variant="secondary" onPress={onRun}>
          {t("backtests.scan.run-cell")}
        </Button>
      </div>
      <p className="text-xs text-muted">
        {t("backtests.scan.out-of-sample-hint")}
      </p>
    </section>
  );
}

/**
 * A scan's grid as a heat map of each cell's in-sample Sharpe ratio, its plateau outlined, and the
 * cell picked shown in full. Out-of-sample figures stay hidden until asked for, and then only the
 * picked cell's, so the grid is read to pick on the in-sample stretch alone; a cell may then be run
 * on its own, which shows its record whole.
 */
export function ScanReport({
  setup,
  scan,
  onRunCell,
}: {
  setup: ScanSetup;
  scan: BacktestScan;
  onRunCell: (setup: BacktestSetup) => void;
}) {
  const { t, i18n } = useTranslation();
  const format = numberFormats(i18n.language);
  const cellName = useCellName(setup);
  const [picked, setPicked] = useState(scan.plateau?.cell ?? 0);
  const figures = scan.cells[picked];
  const warnings: RunWarning[] = [];

  if (!scan.plateau) {
    warnings.push({ id: "no-plateau", text: t("backtests.scan.no-plateau") });
  } else if (scan.plateau.edge) {
    warnings.push({ id: "edge", text: t("backtests.scan.edge") });
  }

  const runPicked = () =>
    onRunCell({
      symbol: setup.symbol,
      interval: setup.interval,
      years: setup.years,
      capital: setup.capital,
      costs: setup.costs,
      strategy: gridSetups(setup.strategy, setup.rows, setup.columns)[picked],
      split: setup.split,
    });

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <p className="text-xs text-muted tabular-nums">
        {t("backtests.scan.span", {
          count: scan.cells.length,
          bars: format.amount.format(scan.bars),
          interval: t(`chart.intervals.${scan.interval}`),
        })}
      </p>
      <RunWarnings warnings={warnings} />
      <ScanHeatMap
        setup={setup}
        scan={scan}
        picked={picked}
        onPick={setPicked}
      />
      {figures ? (
        <PickedCell
          // Out-of-sample figures hide again as another cell is picked.
          key={picked}
          name={cellName(picked)}
          plateau={picked === scan.plateau?.cell}
          figures={figures}
          onRun={runPicked}
        />
      ) : null}
    </div>
  );
}
