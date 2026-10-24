import type { ReactNode } from "react";

import { Switch, ToggleButton, ToggleButtonGroup } from "@heroui/react";
import { skipToken, useQuery } from "@tanstack/react-query";
import type { UseQueryResult } from "@tanstack/react-query";
import { isEqual } from "es-toolkit";
import { useTranslation } from "react-i18next";

import { symbolKey } from "@solyx/core/market";
import type { SymbolRef } from "@solyx/core/market";
import { isEnumValue } from "@solyx/utils/is";

import { LoadError } from "../../components/load-error.tsx";
import { LoadingState } from "../../components/loading-state.tsx";

import type { FormRequest } from "./backtest-form-values.ts";
import { BacktestForm } from "./backtest-form.tsx";
import {
  backtestQuery,
  scanQuery,
  walkForwardQuery,
} from "./backtest-query.ts";
import { BacktestReport } from "./backtest-report.tsx";
import { BacktestMode, useBacktestStore } from "./backtest-store.ts";
import type { ListingBacktests } from "./backtest-store.ts";
import { BacktestTrades } from "./backtest-trades.tsx";
import { EquityChart } from "./equity-chart.tsx";
import { ScanReport } from "./scan-report.tsx";
import { WalkReport } from "./walk-report.tsx";

/** What a mode's query has come to: nothing asked yet, loading, failed or its answer for `setup`. */
function Outcome<Setup, Data>({
  setup,
  query,
  children,
}: {
  setup: Setup | undefined;
  query: UseQueryResult<Data>;
  children: (setup: Setup, data: Data) => ReactNode;
}) {
  const { t } = useTranslation();

  if (setup === undefined) {
    return <p className="text-sm text-muted">{t("backtests.idle")}</p>;
  }

  if (query.error) {
    return (
      <LoadError error={query.error} onRetry={() => void query.refetch()} />
    );
  }

  return query.data === undefined ? (
    <LoadingState />
  ) : (
    children(setup, query.data)
  );
}

/** Each mode's last setup asked of the backend, by the listing's panel. */
function useModeQueries(runs: Partial<ListingBacktests>) {
  return {
    [BacktestMode.Run]: useQuery(backtestQuery(runs.run ?? skipToken)),
    [BacktestMode.Scan]: useQuery(scanQuery(runs.scan ?? skipToken)),
    [BacktestMode.WalkForward]: useQuery(
      walkForwardQuery(runs.walkForward ?? skipToken)
    ),
  };
}

/** The last run of `mode`, as far as it has come. */
function ModeOutcome({
  symbol,
  mode,
  runs,
  queries,
}: {
  symbol: SymbolRef;
  mode: BacktestMode;
  runs: Partial<ListingBacktests>;
  queries: ReturnType<typeof useModeQueries>;
}) {
  const run = useBacktestStore((state) => state.run);

  switch (mode) {
    case BacktestMode.Run:
      return (
        <Outcome setup={runs.run} query={queries.run}>
          {(setup, result) => (
            <div className="flex min-w-0 flex-col gap-5">
              <BacktestReport
                setup={setup}
                result={result}
                onReadLonger={(years) => run({ ...setup, years })}
              />
              <EquityChart
                capital={result.capital}
                equity={result.equity}
                holding={result.holding}
                split={result.outOfSample?.from ?? null}
              />
              <BacktestTrades market={symbol.market} trades={result.trades} />
            </div>
          )}
        </Outcome>
      );
    case BacktestMode.Scan:
      return (
        <Outcome setup={runs.scan} query={queries.scan}>
          {(setup, result) => (
            <ScanReport
              // A new scan starts from its own plateau.
              key={JSON.stringify(setup)}
              setup={setup}
              scan={result}
              onRunCell={run}
            />
          )}
        </Outcome>
      );
    case BacktestMode.WalkForward:
      return (
        <Outcome setup={runs.walkForward} query={queries.walkForward}>
          {(setup, result) => <WalkReport setup={setup} walk={result} />}
        </Outcome>
      );
  }
}

/** The switch between running one setup, a scan and a walk forward. */
function ModeSwitch({
  mode,
  onChange,
}: {
  mode: BacktestMode;
  onChange: (mode: BacktestMode) => void;
}) {
  const { t } = useTranslation();

  return (
    <ToggleButtonGroup
      aria-label={t("backtests.modes.label")}
      selectionMode="single"
      disallowEmptySelection
      size="sm"
      className="w-full [&>*]:flex-1"
      selectedKeys={[mode]}
      onSelectionChange={(keys) => {
        const [next] = keys;

        if (isEnumValue(BacktestMode, next)) onChange(next);
      }}>
      {Object.values(BacktestMode).map((each) => (
        <ToggleButton key={each} id={each}>
          {t(`backtests.modes.${each}.label`)}
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  );
}

/** Whether the chart above marks the single run's trades. */
function ChartSwitch() {
  const { t } = useTranslation();
  const onChart = useBacktestStore((state) => state.onChart);
  const setOnChart = useBacktestStore((state) => state.setOnChart);

  return (
    <Switch
      size="sm"
      className="ml-auto"
      isSelected={onChart}
      onChange={setOnChart}>
      <Switch.Content>
        <Switch.Control>
          <Switch.Thumb />
        </Switch.Control>
        <span className="text-xs text-muted">
          {t("backtests.chart.on-chart")}
        </span>
      </Switch.Content>
    </Switch>
  );
}

/**
 * Backtests a listing without the agent: one setup, a grid of a template's numbers, or that grid
 * picked from as it walks forward, set up on one side and the last run of the mode shown on the
 * other. The chart above marks the single run's trades. Nothing it runs reaches a model.
 */
export function BacktestPanel({
  symbol,
  heading,
}: {
  symbol: SymbolRef;
  /** What leads the header row, such as the switch between this and the news. */
  heading: ReactNode;
}) {
  const { t } = useTranslation();
  const key = symbolKey(symbol);
  const listing = useBacktestStore((state) => state.listings[key]);
  const store = useBacktestStore();
  const runs: Partial<ListingBacktests> = listing ?? {};
  const mode = runs.mode ?? BacktestMode.Run;
  const queries = useModeQueries(runs);

  // The same setup again asks again, since the bars may have moved on.
  function submit(request: FormRequest) {
    if (isEqual(request.setup, runs[request.mode])) {
      void queries[request.mode].refetch();
    } else if (request.mode === BacktestMode.Run) {
      store.run(request.setup);
    } else if (request.mode === BacktestMode.Scan) {
      store.scan(request.setup);
    } else {
      store.walkForward(request.setup);
    }
  }

  return (
    <section
      aria-label={t("backtests.title")}
      className="flex h-full flex-col overflow-hidden">
      <div className="flex h-10 shrink-0 items-center gap-3 border-b border-separator px-6">
        {heading}
        <ChartSwitch />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* Side by side where the main view is wide; narrower, the run follows its setup. */}
        <div className="grid items-start gap-6 px-6 py-4 @min-[56rem]/main:grid-cols-[20rem_minmax(0,1fr)]">
          <div className="flex flex-col gap-3">
            <ModeSwitch
              mode={mode}
              onChange={(next) => store.setMode(symbol, next)}
            />
            <BacktestForm
              key={key}
              symbol={symbol}
              mode={mode}
              setup={runs[mode] ?? runs.run ?? runs.scan ?? runs.walkForward}
              isRunning={queries[mode].isFetching}
              onSubmit={submit}
            />
          </div>
          <div className="min-w-0">
            <ModeOutcome
              symbol={symbol}
              mode={mode}
              runs={runs}
              queries={queries}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
