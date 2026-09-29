import { EmptyState, Skeleton, Spinner } from "@heroui/react";
import { useQuery } from "@tanstack/react-query";
import { CatchBoundary } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import type { Interval } from "@solyx/core/candles";
import type { SymbolRef } from "@solyx/core/market";

import { ErrorAlert } from "../../components/error-alert.tsx";
import { ErrorFallback } from "../../components/error-fallback.tsx";

import { candlesQuery } from "./candles-query.ts";
import { PRICE_CHART_CLASS, PriceChart } from "./price-chart.tsx";

/** One listing's chart with its load, empty and error states; a chart that fails to render leaves the toolbar usable. */
export function SymbolChart({
  symbol,
  interval,
}: {
  symbol: SymbolRef;
  interval: Interval;
}) {
  const { t } = useTranslation();

  const { data, error, refetch, isPlaceholderData } = useQuery(
    candlesQuery(symbol, interval)
  );

  if (error) {
    return (
      <ErrorAlert
        title={t("common.load-failed")}
        description={error.message}
        onRetry={() => void refetch()}
      />
    );
  }

  if (!data) return <Skeleton className={`${PRICE_CHART_CLASS} rounded-xl`} />;

  if (data.candles.length === 0) {
    return <EmptyState>{t("chart.no-data")}</EmptyState>;
  }

  // Each listing and interval gets a fresh chart, time scale and error boundary.
  const dataset = `${data.symbol.market}:${data.symbol.symbol}:${data.interval}`;

  return (
    <div className="relative" aria-busy={isPlaceholderData}>
      <CatchBoundary getResetKey={() => dataset} errorComponent={ErrorFallback}>
        <PriceChart
          key={dataset}
          candles={data.candles}
          market={data.symbol.market}
          interval={data.interval}
        />
      </CatchBoundary>
      {isPlaceholderData ? (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-background/50">
          <Spinner />
        </div>
      ) : null}
    </div>
  );
}
