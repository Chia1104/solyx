import type { ReactNode } from "react";

import { Alert, EmptyState, Skeleton, Spinner } from "@heroui/react";
import { buttonVariants } from "@heroui/styles";
import { CatchBoundary, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import type { Candle, Interval } from "@solyx/core/candles";
import { symbolKey } from "@solyx/core/market";
import type { SymbolRef } from "@solyx/core/market";

import type { MarketDataSource } from "#shared/ipc/settings.ts";

import { ErrorFallback } from "../../components/error-fallback.tsx";
import { FallbackFrame } from "../../components/fallback-frame.tsx";
import { LoadError } from "../../components/load-error.tsx";
import { SettingsSection } from "../settings/settings-section.ts";

import { PriceChart } from "./price-chart.tsx";
import { useCandles } from "./use-candles.ts";

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
        search={{ section: SettingsSection.MarketData }}
        className={buttonVariants({ size: "sm", variant: "secondary" })}>
        {t("chart.open-settings")}
      </Link>
    </Alert>
  );
}

/**
 * One listing's chart with its load, empty and error states, filling its container; a chart
 * that fails to render leaves the toolbar usable.
 */
export function SymbolChart({
  symbol,
  interval,
  overlay,
}: {
  symbol: SymbolRef;
  interval: Interval;
  /** What else to draw on the price pane, given the bars the chart shows. */
  overlay?: (candles: Candle[]) => ReactNode;
}) {
  const { t } = useTranslation();
  const { settings, source, candles } = useCandles(symbol, interval);

  if (settings.error) {
    return (
      <FallbackFrame>
        <LoadError
          error={settings.error}
          onRetry={() => void settings.refetch()}
        />
      </FallbackFrame>
    );
  }

  // A source missing its settings has no data, so the chart asks for them instead. This is
  // checked before the bars' error, which may predate the change that left the source unready.
  if (source && !source.ready) {
    return (
      <FallbackFrame>
        <SetupRequired source={source.source} />
      </FallbackFrame>
    );
  }

  if (candles.error) {
    return (
      <FallbackFrame>
        <LoadError
          error={candles.error}
          onRetry={() => void candles.refetch()}
        />
      </FallbackFrame>
    );
  }

  const {
    data,
    isPlaceholderData,
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
  } = candles;

  // Bars standing in for another interval, or a page that failed, ask for nothing more.
  const loadOlder = () => {
    if (
      hasNextPage &&
      !isFetchingNextPage &&
      !isFetchNextPageError &&
      !isPlaceholderData
    ) {
      void candles.fetchNextPage();
    }
  };

  if (!data) return <Skeleton className="size-full rounded-sm" />;

  if (data.candles.length === 0) {
    return (
      <FallbackFrame>
        <EmptyState className="text-center">{t("chart.no-data")}</EmptyState>
      </FallbackFrame>
    );
  }

  // Each listing and interval gets a fresh chart, time scale and error boundary.
  const dataset = `${symbolKey(data.symbol)}:${data.interval}`;

  return (
    <div className="relative size-full" aria-busy={isPlaceholderData}>
      <CatchBoundary getResetKey={() => dataset} errorComponent={ErrorFallback}>
        <PriceChart
          key={dataset}
          candles={data.candles}
          market={data.symbol.market}
          interval={data.interval}
          onNearOldest={loadOlder}>
          {overlay?.(data.candles)}
        </PriceChart>
      </CatchBoundary>
      {isFetchingNextPage ? (
        <Spinner
          size="sm"
          aria-label={t("chart.loading-older")}
          className="absolute top-1/2 left-2 z-20 -translate-y-1/2"
        />
      ) : null}
      {isPlaceholderData ? (
        // Shows only once loading takes a moment, so bars that arrive at once never flash it.
        <div className="absolute inset-0 z-20 flex animate-[fade-in_150ms_var(--ease-out-quint)_150ms_both] items-center justify-center bg-background/50">
          <Spinner />
        </div>
      ) : null}
    </div>
  );
}
