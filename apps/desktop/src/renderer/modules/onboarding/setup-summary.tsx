import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { Market } from "@solyx/core/market";

import {
  isDecisionsReady,
  isMarketDataReady,
  isWebSearchReady,
} from "#shared/ipc/settings.ts";

import { accountQuery } from "../account/account-query.ts";
import { SettingsList, SettingsRow } from "../settings/settings-list.tsx";
import {
  agentSettingsQuery,
  decisionsSettingsQuery,
  marketDataQuery,
  secretsQuery,
  webSearchSettingsQuery,
} from "../settings/settings-query.ts";

/** What first-run setup left in place, so the last step says what works and what is still to do. */
export function SetupSummary() {
  const { t } = useTranslation();
  const { data: marketData } = useQuery(marketDataQuery());
  const { data: agent } = useQuery(agentSettingsQuery());
  const { data: webSearch } = useQuery(webSearchSettingsQuery());
  const { data: decisions } = useQuery(decisionsSettingsQuery());
  const { data: secrets } = useQuery(secretsQuery());
  const { data: account } = useQuery(accountQuery());

  const readiness = (ready: boolean) =>
    ready ? t("onboarding.done.ready") : t("onboarding.done.incomplete");

  const source = marketData?.markets[Market.TW];

  const model = agent?.models.find(
    (option) => option.provider === agent.provider && option.id === agent.model
  );

  return (
    <SettingsList>
      <SettingsRow
        label={t("onboarding.done.market-data")}
        description={
          source ? t(`settings.market-data.sources.${source.source}`) : null
        }
        value={readiness(isMarketDataReady(marketData))}
      />
      <SettingsRow
        label={t("onboarding.done.agent")}
        description={model?.name}
        value={readiness(agent?.ready === true)}
      />
      <SettingsRow
        label={t("onboarding.done.web-search")}
        description={
          webSearch
            ? t(`settings.web-search.providers.${webSearch.provider}`)
            : null
        }
        value={readiness(isWebSearchReady(webSearch))}
      />
      <SettingsRow
        label={t("onboarding.done.decisions")}
        description={
          decisions
            ? t(`settings.decisions.providers.${decisions.provider}`)
            : null
        }
        value={readiness(isDecisionsReady(decisions, secrets))}
      />
      <SettingsRow
        label={t("onboarding.done.trading")}
        description={t("onboarding.done.paper-note")}
        value={account ? t(`broker-mode.${account.brokerMode}`) : null}
      />
    </SettingsList>
  );
}
