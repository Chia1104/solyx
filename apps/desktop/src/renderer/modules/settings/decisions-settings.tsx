import { useMemo } from "react";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import * as z from "zod";

import { Secret } from "#shared/ipc/settings.ts";

import { LoadError } from "../../components/load-error.tsx";
import { LoadingState } from "../../components/loading-state.tsx";
import { Section } from "../../components/section.tsx";
import { RailedColumn } from "../../components/sheet.tsx";

import { AppSecretRow, SecretsUnavailable } from "./secret-row.tsx";
import { SettingsList } from "./settings-list.tsx";
import {
  decisionsSettingsQuery,
  secretsQuery,
  settingsQueryKeys,
} from "./settings-query.ts";
import { TextSettingRow } from "./text-setting-row.tsx";

/** The decisions model that scores news and posts: its key, model and endpoint. */
export function DecisionsSettings() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const settings = useQuery(decisionsSettingsQuery());
  const secrets = useQuery(secretsQuery());

  // Rebuilt per language so field errors come out localized.
  const schemas = useMemo(
    () => ({
      model: z
        .string()
        .trim()
        .min(1, { error: t("settings.decisions.model-required") })
        .max(200),
      baseURL: z
        .string()
        .trim()
        .pipe(
          z.url({
            protocol: /^https?$/,
            error: t("settings.decisions.base-url-invalid"),
          })
        ),
    }),
    [t]
  );

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: settingsQueryKeys.decisions });

  const error = settings.error ?? secrets.error;

  if (error) {
    return (
      <RailedColumn className="px-6 py-5">
        <LoadError
          error={error}
          onRetry={() => {
            void settings.refetch();
            void secrets.refetch();
          }}
        />
      </RailedColumn>
    );
  }

  if (!settings.data || !secrets.data) return <LoadingState />;

  const { model, baseURL, defaults } = settings.data;
  const { available, states } = secrets.data;

  return (
    <Section
      title={t("settings.decisions.title")}
      description={t("settings.decisions.description")}>
      <div className="flex flex-col gap-3">
        {available ? null : <SecretsUnavailable />}
        <SettingsList>
          <AppSecretRow
            secret={Secret.DecisionsApiKey}
            state={states[Secret.DecisionsApiKey]}
            available={available}
          />
          <TextSettingRow
            label={t("settings.decisions.model")}
            description={t("settings.decisions.model-description")}
            value={model}
            isDefault={model === defaults.model}
            schema={schemas.model}
            onSave={(next) => window.solyx.settings.setDecisionsModel(next)}
            onSettled={refresh}
          />
          <TextSettingRow
            label={t("settings.decisions.base-url")}
            description={t("settings.decisions.base-url-description")}
            value={baseURL}
            isDefault={baseURL === defaults.baseURL}
            schema={schemas.baseURL}
            onSave={(next) => window.solyx.settings.setDecisionsBaseURL(next)}
            onSettled={refresh}
          />
        </SettingsList>
      </div>
    </Section>
  );
}
