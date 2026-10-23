import { useMemo } from "react";

import { Switch } from "@heroui/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { onThisComputer } from "@solyx/api/embeddings";
import { Secret, endpointSchema } from "@solyx/api/settings";
import {
  EMBEDDINGS_DEFAULTS,
  EmbeddingsProvider,
} from "@solyx/embeddings/provider";
import { isEnumValue } from "@solyx/utils/is";

import { client } from "../../app/rpc.ts";
import { ErrorAlert } from "../../components/error-alert.tsx";
import { SectionLoadError } from "../../components/load-error.tsx";
import { LoadingState } from "../../components/loading-state.tsx";
import { OptionSelect } from "../../components/option-select.tsx";
import { Section } from "../../components/section.tsx";
import { LocalModelRow } from "../embeddings/local-model-row.tsx";

import { matching } from "./matching.ts";
import { AppSecretRow, SecretsUnavailable } from "./secret-row.tsx";
import { SettingsList, SettingsRow } from "./settings-list.tsx";
import { embeddingsSettingsQuery, secretsQuery } from "./settings-query.ts";
import { TextSettingRow } from "./text-setting-row.tsx";

/** Experimental: news grouping that also joins items whose vectors read alike. */
export function EmbeddingsSettings() {
  const { t } = useTranslation();
  const settings = useQuery(embeddingsSettingsQuery());
  const secrets = useQuery(secretsQuery());

  const save = useMutation({
    mutationFn: (change: () => Promise<void>) => change(),
  });

  // Rebuilt per language so the field's error comes out localized.
  const baseURLSchema = useMemo(
    () => matching(endpointSchema, t("settings.embeddings.base-url-invalid")),
    [t]
  );

  const error = settings.error ?? secrets.error;

  if (error) {
    return (
      <SectionLoadError
        error={error}
        onRetry={() =>
          void Promise.all([settings.refetch(), secrets.refetch()])
        }
      />
    );
  }

  if (!settings.data || !secrets.data) return <LoadingState />;

  const { enabled, provider, space, measured, ollamaBaseURL } = settings.data;
  const { available, states } = secrets.data;
  const enabledLabel = t("settings.embeddings.enabled");
  const providerLabel = t("settings.embeddings.provider");

  return (
    <Section
      title={t("settings.embeddings.title")}
      description={t("settings.embeddings.description")}>
      <div className="flex flex-col gap-3">
        <SettingsList>
          <SettingsRow
            label={enabledLabel}
            description={t("settings.embeddings.enabled-description")}
            actions={
              <Switch
                isSelected={enabled}
                isDisabled={save.isPending}
                onChange={(next) =>
                  save.mutate(() => client.settings.setEmbeddingsEnabled(next))
                }>
                <Switch.Content>
                  <Switch.Control>
                    <Switch.Thumb />
                  </Switch.Control>
                  <span className="sr-only">{enabledLabel}</span>
                </Switch.Content>
              </Switch>
            }
          />
          <SettingsRow
            label={providerLabel}
            description={
              provider === EmbeddingsProvider.Local &&
              !onThisComputer(ollamaBaseURL)
                ? t("settings.embeddings.provider-descriptions.local-host", {
                    host: new URL(ollamaBaseURL).host,
                  })
                : t(`settings.embeddings.provider-descriptions.${provider}`)
            }
            actions={
              <OptionSelect
                aria-label={providerLabel}
                className="w-44"
                value={provider}
                isDisabled={save.isPending}
                options={Object.values(EmbeddingsProvider).map((each) => ({
                  id: each,
                  label: t(`settings.embeddings.providers.${each}`),
                }))}
                onChange={(next) => {
                  if (!isEnumValue(EmbeddingsProvider, next)) return;

                  save.mutate(() =>
                    client.settings.setEmbeddingsProvider(next)
                  );
                }}
              />
            }
          />
          <SettingsRow
            label={t("settings.embeddings.model")}
            description={
              measured
                ? t("settings.embeddings.measured")
                : t("settings.embeddings.unmeasured")
            }
            value={space}
          />
          {provider === EmbeddingsProvider.Local ? (
            <>
              <TextSettingRow
                label={t("settings.embeddings.base-url")}
                description={t("settings.embeddings.base-url-description")}
                value={ollamaBaseURL}
                isDefault={
                  ollamaBaseURL ===
                  EMBEDDINGS_DEFAULTS[EmbeddingsProvider.Local].baseURL
                }
                schema={baseURLSchema}
                onSave={(next) => client.settings.setOllamaBaseURL(next)}
              />
              {available ? (
                <AppSecretRow
                  secret={Secret.OllamaEmbeddingsApiKey}
                  state={states[Secret.OllamaEmbeddingsApiKey]}
                  available={available}
                  optional
                />
              ) : null}
              <LocalModelRow />
            </>
          ) : null}
          {provider === EmbeddingsProvider.OpenAI ? (
            available ? (
              <AppSecretRow
                secret={Secret.EmbeddingsApiKey}
                state={states[Secret.EmbeddingsApiKey]}
                available={available}
              />
            ) : (
              <SecretsUnavailable />
            )
          ) : null}
        </SettingsList>
        {save.error ? (
          <ErrorAlert
            title={t("settings.save-failed")}
            description={save.error.message}
          />
        ) : null}
      </div>
    </Section>
  );
}
