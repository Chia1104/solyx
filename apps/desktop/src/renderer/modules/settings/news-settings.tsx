import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { Secret } from "#shared/ipc/settings.ts";

import { LoadError } from "../../components/load-error.tsx";
import { LoadingState } from "../../components/loading-state.tsx";
import { Section } from "../../components/section.tsx";
import { RailedColumn } from "../../components/sheet.tsx";

import { AppSecretRow, SecretsUnavailable } from "./secret-row.tsx";
import { SettingsList } from "./settings-list.tsx";
import { secretsQuery } from "./settings-query.ts";

/** The news source the agent searches: Firecrawl, on the user's own key. */
export function NewsSettings() {
  const { t } = useTranslation();
  const { data, error, refetch } = useQuery(secretsQuery());

  if (error) {
    return (
      <RailedColumn className="px-6 py-5">
        <LoadError error={error} onRetry={() => void refetch()} />
      </RailedColumn>
    );
  }

  if (!data) return <LoadingState />;

  const { available, states } = data;

  return (
    <Section
      title={t("settings.news.title")}
      description={t("settings.news.description")}>
      <div className="flex flex-col gap-3">
        {available ? null : <SecretsUnavailable />}
        <SettingsList>
          <AppSecretRow
            secret={Secret.FirecrawlApiKey}
            state={states[Secret.FirecrawlApiKey]}
            available={available}
          />
        </SettingsList>
      </div>
    </Section>
  );
}
