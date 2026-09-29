import { Alert, EmptyState, Skeleton, Spinner } from "@heroui/react";
import { buttonVariants } from "@heroui/styles";
import { useQuery } from "@tanstack/react-query";
import { CatchBoundary, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import type { Interval } from "@solyx/core/candles";
import type { SymbolRef } from "@solyx/core/market";

import { MARKET_DATA_SECRET, SecretState } from "#shared/ipc/settings.ts";
import type { Secret } from "#shared/ipc/settings.ts";

import { ErrorAlert } from "../../components/error-alert.tsx";
import { ErrorFallback } from "../../components/error-fallback.tsx";
import { secretsQuery } from "../settings/settings-query.ts";

import { candlesQuery } from "./candles-query.ts";
import { useLiveCandles } from "./live-candles.ts";
import { PRICE_CHART_CLASS, PriceChart } from "./price-chart.tsx";

function KeyRequired({ secret }: { secret: Secret }) {
  const { t } = useTranslation();

  return (
    <Alert status="accent">
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Title>
          {t("chart.key-required", {
            name: t(`settings.api-keys.names.${secret}`),
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
  const secret = MARKET_DATA_SECRET[symbol.market];
  const secrets = useQuery({ ...secretsQuery(), enabled: secret !== null });

  // Without its provider's key a market has no data, so the chart asks for the key instead.
  const hasKey =
    secret === null || secrets.data?.states[secret] === SecretState.Saved;

  const live = useLiveCandles(symbol, interval, hasKey);

  const candles = useQuery({
    ...candlesQuery(symbol, interval, live),
    enabled: hasKey,
  });

  const error = secrets.error ?? candles.error;

  if (error) {
    return (
      <ErrorAlert
        title={t("common.load-failed")}
        description={error.message}
        onRetry={() =>
          void (secrets.error ? secrets.refetch() : candles.refetch())
        }
      />
    );
  }

  if (secret !== null && secrets.data && !hasKey) {
    return <KeyRequired secret={secret} />;
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
