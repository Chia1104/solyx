import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { Market } from "@solyx/core/market";

import { MarketDataSource } from "#shared/ipc/settings.ts";

import { LoadError } from "../../components/load-error.tsx";
import { LoadingState } from "../../components/loading-state.tsx";
import { Section } from "../../components/section.tsx";
import { RailedColumn } from "../../components/sheet.tsx";

import { FubonSettings } from "./fubon-settings.tsx";
import { FugleSettings } from "./fugle-settings.tsx";
import { MarketDataSourceSelect } from "./market-data-source.tsx";
import { marketDataQuery } from "./settings-query.ts";

/** The Taiwan source, then only what that source needs set up. */
export function MarketDataSettings() {
  const { t } = useTranslation();
  const { data, error, refetch } = useQuery(marketDataQuery());

  if (error) {
    return (
      <RailedColumn className="px-6 py-5">
        <LoadError error={error} onRetry={() => void refetch()} />
      </RailedColumn>
    );
  }

  if (!data) return <LoadingState />;

  const current = data.markets[Market.TW];

  if (!current) return null;

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
        {current.source === MarketDataSource.Fubon ? (
          <FubonSettings status={data} />
        ) : (
          <FugleSettings status={data} />
        )}
      </Section>
      <RailedColumn className="px-6 py-4 text-xs text-muted">
        {t("settings.market-data.description")}
      </RailedColumn>
    </>
  );
}
