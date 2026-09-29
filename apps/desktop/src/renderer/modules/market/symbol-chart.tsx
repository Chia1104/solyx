import { Alert, EmptyState, Skeleton, Spinner } from "@heroui/react";
import { buttonVariants } from "@heroui/styles";
import { useQuery } from "@tanstack/react-query";
import { CatchBoundary, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import type { Interval } from "@solyx/core/candles";
import type { SymbolRef } from "@solyx/core/market";

import type { MarketDataSource } from "#shared/ipc/settings.ts";

import { ErrorAlert } from "../../components/error-alert.tsx";
import { ErrorFallback } from "../../components/error-fallback.tsx";
import { marketDataQuery } from "../settings/settings-query.ts";

import { candlesQuery } from "./candles-query.ts";
import { useLiveCandles } from "./live-candles.ts";
import { PRICE_CHART_CLASS, PriceChart } from "./price-chart.tsx";

function SetupRequired({ source }: { source: MarketDataSource }) {
  const { t } = useTranslation();

  return (
    <Alert status="accent">
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Title>
          {t("chart.setup-required", {
            source: t(`settings.market-data.sources.${source}`),
          })}
        </Alert.Title>
      </Alert.Content>
      <Link
        to="/settings"
        className={buttonVariants({ size: "sm", variant: "secondary" })}>
        {t("chart.open-settings")}
      </Link>
    </Alert>
  );
}

/** One listing's chart with its load, empty and error states; a chart that fails to render leaves the toolbar usable. */
export function SymbolChart({
  symbol,
  interval,
}: {
  symbol: SymbolRef;
  interval: Interval;
}) {
  const { t } = useTranslation();
  const settings = useQuery(marketDataQuery());
  const source = settings.data?.markets[symbol.market];

  // A source missing its settings has no data, so the chart asks for them instead. A market
  // without a source still loads, so the main process can say why it has none.
  const ready = source === null || source?.ready === true;

  const live = useLiveCandles(symbol, interval, ready);

  const candles = useQuery({
    ...candlesQuery(symbol, interval, live),
    enabled: ready,
  });

  if (settings.error) {
    return (
      <ErrorAlert
        title={t("common.load-failed")}
        description={settings.error.message}
        onRetry={() => void settings.refetch()}
      />
    );
  }

  // Checked before the bars' error, which may predate the change that left the source unready.
  if (source && !source.ready) return <SetupRequired source={source.source} />;

  if (candles.error) {
    return (
      <ErrorAlert
        title={t("common.load-failed")}
        description={candles.error.message}
        onRetry={() => void candles.refetch()}
      />
    );
  }

  const { data, isPlaceholderData } = candles;

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
