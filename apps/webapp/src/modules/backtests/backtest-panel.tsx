import { useState } from "react";
import type { ReactNode } from "react";

import { Switch, ToggleButton, ToggleButtonGroup } from "@heroui/react";
import { skipToken, useQuery } from "@tanstack/react-query";
import type { UseQueryResult } from "@tanstack/react-query";
import { isEqual } from "es-toolkit";
import { useTranslation } from "react-i18next";

import { BacktestMode } from "@solyx/api/backtests";
import type { BacktestRequest, BacktestSetup } from "@solyx/api/backtests";
import { symbolKey } from "@solyx/core/market";
import type { SymbolRef } from "@solyx/core/market";
import { isEnumValue } from "@solyx/utils/is";

import { LoadError } from "../../components/load-error.tsx";
import { LoadingState } from "../../components/loading-state.tsx";

import { AskAgent, KeepAsStrategy } from "./agent-bridge.tsx";
import { BacktestCompare } from "./backtest-compare.tsx";
import { BacktestForm } from "./backtest-form.tsx";
import { BacktestHistory } from "./backtest-history.tsx";
import {
  backtestQuery,
  rollingQuery,
  scanQuery,
  walkForwardQuery,
} from "./backtest-query.ts";
import { BacktestReport } from "./backtest-report.tsx";
import { PanelView, useBacktestStore } from "./backtest-store.ts";
import type { ListingBacktests } from "./backtest-store.ts";
import { BacktestTrades } from "./backtest-trades.tsx";
import { EquityChart } from "./equity-chart.tsx";
import { historyQuery } from "./history-query.ts";
import { RollingReport } from "./rolling-report.tsx";
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
    [BacktestMode.Rolling]: useQuery(rollingQuery(runs.rolling ?? skipToken)),
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
  const ask = useBacktestStore((state) => state.ask);

  const run = (setup: BacktestSetup) => ask({ mode: BacktestMode.Run, setup });

  switch (mode) {
    case BacktestMode.Run:
      return (
        <Outcome setup={runs.run} query={queries.run}>
          {(setup, result) => (
            <div className="flex min-w-0 flex-col gap-5">
              <div className="flex justify-end gap-2">
                {"name" in setup.strategy ? null : <KeepAsStrategy />}
                <AskAgent />
              </div>
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
    case BacktestMode.Rolling:
      return (
        <Outcome setup={runs.rolling} query={queries.rolling}>
          {(_, result) => <RollingReport rolling={result} />}
        </Outcome>
      );
  }
}

/** The switch between running one setup, a scan, a walk forward, rolling windows and the runs kept. */
function ViewSwitch({
  view,
  onChange,
}: {
  view: PanelView;
  onChange: (view: PanelView) => void;
}) {
  const { t } = useTranslation();

  return (
    <ToggleButtonGroup
      aria-label={t("backtests.modes.label")}
      selectionMode="single"
      disallowEmptySelection
      size="sm"
      className="w-full [&>*]:flex-1"
      selectedKeys={[view]}
      onSelectionChange={(keys) => {
        const [next] = keys;

        if (isEnumValue(PanelView, next)) onChange(next);
      }}>
      {Object.values(PanelView).map((each) => (
        <ToggleButton key={each} id={each}>
          {each === PanelView.History
            ? t("backtests.history.title")
            : t(`backtests.modes.${each}.label`)}
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

/** The runs kept beside a comparison of those picked from them. */
function HistoryView({ symbol }: { symbol: SymbolRef }) {
  const [picked, setPicked] = useState<string[]>([]);
  const { data } = useQuery(historyQuery());

  // In the order they were picked, leaving out any removed meanwhile.
  const records = picked.flatMap(
    (id) => data?.filter((record) => record.id === id) ?? []
  );

  return (
    <>
      <BacktestHistory symbol={symbol} picked={picked} onPick={setPicked} />
      <div className="min-w-0">
        <BacktestCompare records={records} />
      </div>
    </>
  );
}

/** A mode's setup beside the last run of it. */
function ModeView({
  symbol,
  mode,
  runs,
}: {
  symbol: SymbolRef;
  mode: BacktestMode;
  runs: Partial<ListingBacktests>;
}) {
  const ask = useBacktestStore((state) => state.ask);
  const queries = useModeQueries(runs);

  // The same setup again asks again, since the bars may have moved on.
  function submit(request: BacktestRequest) {
    if (isEqual(request.setup, runs[request.mode])) {
      void queries[request.mode].refetch();
    } else {
      ask(request);
    }
  }

  return (
    <>
      <BacktestForm
        symbol={symbol}
        mode={mode}
        setup={
          runs[mode] ??
          runs.run ??
          runs.scan ??
          runs.walkForward ??
          runs.rolling
        }
        isRunning={queries[mode].isFetching}
        onSubmit={submit}
      />
      <div className="min-w-0">
        <ModeOutcome
          symbol={symbol}
          mode={mode}
          runs={runs}
          queries={queries}
        />
      </div>
    </>
  );
}

/**
 * Backtests a listing without the agent: one setup, a grid of a template's numbers, that grid
 * picked from as it walks forward, or one setup over windows that start month after month, set up
 * on one side and the last run of the mode shown on the other, and the runs kept beside a
 * comparison of those picked. The chart above marks the single run's trades. Nothing it runs
 * reaches a model.
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
  const setView = useBacktestStore((state) => state.setView);
  const runs: Partial<ListingBacktests> = listing ?? {};
  const view = runs.view ?? PanelView.Run;

  return (
    <section
      aria-label={t("backtests.title")}
      className="flex h-full flex-col overflow-hidden">
      <div className="flex h-10 shrink-0 items-center gap-3 border-b border-separator px-6">
        {heading}
        <ChartSwitch />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex flex-col gap-3 px-6 pt-4">
          <ViewSwitch view={view} onChange={(next) => setView(symbol, next)} />
        </div>
        {/* Side by side where the main view is wide; narrower, the run follows its setup. */}
        <div className="grid items-start gap-6 px-6 py-4 @min-[56rem]/main:grid-cols-[20rem_minmax(0,1fr)]">
          {view === PanelView.History ? (
            <HistoryView symbol={symbol} />
          ) : (
            <ModeView key={key} symbol={symbol} mode={view} runs={runs} />
          )}
        </div>
      </div>
    </section>
  );
}
