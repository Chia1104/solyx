import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { MarketDataSource } from "@solyx/api/settings";
import { Market } from "@solyx/core/market";

import { SectionLoadError } from "../../components/load-error.tsx";
import { LoadingState } from "../../components/loading-state.tsx";
import { Section } from "../../components/section.tsx";

import { FinMindSettings } from "./finmind-settings.tsx";
import { FubonConnectionRow, FubonSettings } from "./fubon-settings.tsx";
import { FugleSettings } from "./fugle-settings.tsx";
import { LongbridgeSettings } from "./longbridge-settings.tsx";
import { MarketDataSourceSelect } from "./market-data-source.tsx";
import { marketDataQuery } from "./settings-query.ts";

/**
 * The Taiwan source, then only what that source needs set up, then the US's sign-in. Fubon's sign-in is set up under
 * Brokers, except in first-run setup (`fubonInPlace`), which has no Brokers section to link to.
 */
export function MarketDataSettings({
  fubonInPlace = false,
}: {
  fubonInPlace?: boolean;
}) {
  const { t } = useTranslation();
  const { data, error, refetch } = useQuery(marketDataQuery());

  if (error) {
    return <SectionLoadError error={error} onRetry={() => void refetch()} />;
  }

  if (!data) return <LoadingState />;

  const current = data.markets[Market.TW];
  const sourceTitle = t("settings.market-data.source-title");

  return (
    <>
      <Section
        title={sourceTitle}
        description={t("settings.market-data.source-description")}>
        <MarketDataSourceSelect source={current.source} label={sourceTitle} />
      </Section>
      <Section
        title={t(`settings.market-data.sources.${current.source}`)}
        description={t(`settings.${current.source}.description`)}>
        {current.source === MarketDataSource.Fugle ? (
          <FugleSettings status={data} />
        ) : fubonInPlace ? (
          <FubonSettings status={data} />
        ) : (
          <FubonConnectionRow status={data} />
        )}
      </Section>
      <Section
        title={t("settings.market-data.us-title")}
        description={t("settings.market-data.us-description")}>
        <LongbridgeSettings status={data} />
      </Section>
      <Section
        title={t("settings.fundamentals.title")}
        description={t("settings.fundamentals.description")}>
        <FinMindSettings />
      </Section>
      <p className="px-4 py-2 text-xs text-muted">
        {t("settings.market-data.description")}
      </p>
    </>
  );
}
