import type { ReactNode } from "react";

import { Switch } from "@heroui/react";
import { skipToken, useQuery } from "@tanstack/react-query";
import { isEqual } from "es-toolkit";
import { useTranslation } from "react-i18next";

import type { BacktestSetup } from "@solyx/api/backtests";
import { symbolKey } from "@solyx/core/market";
import type { SymbolRef } from "@solyx/core/market";

import { LoadError } from "../../components/load-error.tsx";
import { LoadingState } from "../../components/loading-state.tsx";

import { BacktestForm } from "./backtest-form.tsx";
import { backtestQuery } from "./backtest-query.ts";
import { BacktestReport } from "./backtest-report.tsx";
import { useBacktestStore } from "./backtest-store.ts";
import { BacktestTrades } from "./backtest-trades.tsx";
import { EquityChart } from "./equity-chart.tsx";

/**
 * Backtests a listing without the agent: a setup on one side, and on the other the run it last
 * made, its record against holding the listing, its equity and its trades, which the chart above
 * marks too. Nothing it runs reaches a model.
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
  const setup = useBacktestStore((state) => state.runs[key]);
  const run = useBacktestStore((state) => state.run);
  const onChart = useBacktestStore((state) => state.onChart);
  const setOnChart = useBacktestStore((state) => state.setOnChart);
  const query = useQuery(backtestQuery(setup ?? skipToken));

  const runSetup = (next: BacktestSetup) => {
    if (isEqual(next, setup)) void query.refetch();
    else run(next);
  };

  let body = <p className="text-sm text-muted">{t("backtests.idle")}</p>;

  if (setup && query.error) {
    body = (
      <LoadError error={query.error} onRetry={() => void query.refetch()} />
    );
  } else if (setup && query.data) {
    const result = query.data;

    body = (
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
    );
  } else if (setup) {
    body = <LoadingState />;
  }

  return (
    <section
      aria-label={t("backtests.title")}
      className="flex h-full flex-col overflow-hidden">
      <div className="flex h-10 shrink-0 items-center gap-3 border-b border-separator px-6">
        {heading}
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
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* Side by side where the main view is wide; narrower, the run follows its setup. */}
        <div className="grid items-start gap-6 px-6 py-4 @min-[56rem]/main:grid-cols-[20rem_minmax(0,1fr)]">
          <BacktestForm
            key={key}
            symbol={symbol}
            setup={setup}
            isRunning={query.isFetching}
            onRun={runSetup}
          />
          <div className="min-w-0">{body}</div>
        </div>
      </div>
    </section>
  );
}
