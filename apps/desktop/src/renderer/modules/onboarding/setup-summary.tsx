import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { Market } from "@solyx/core/market";

import { accountQuery } from "../account/account-query.ts";
import { SettingsList, SettingsRow } from "../settings/settings-list.tsx";
import { marketDataQuery } from "../settings/settings-query.ts";

/** What first-run setup left in place, so the last step says what works and what is still to do. */
export function SetupSummary() {
  const { t } = useTranslation();
  const marketData = useQuery(marketDataQuery());
  const account = useQuery(accountQuery());

  const source = marketData.data?.markets[Market.TW];

  return (
    <SettingsList>
      <SettingsRow
        label={t("onboarding.done.market-data")}
        description={
          source ? t(`settings.market-data.sources.${source.source}`) : null
        }
        value={
          source?.ready
            ? t("onboarding.done.ready")
            : t("onboarding.done.incomplete")
        }
      />
      <SettingsRow
        label={t("onboarding.done.trading")}
        description={t("onboarding.done.paper-note")}
        value={
          account.data ? t(`broker-mode.${account.data.brokerMode}`) : null
        }
      />
    </SettingsList>
  );
}
