import { Switch } from "@heroui/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { EmbeddingsProvider } from "@solyx/embeddings/provider";
import { isEnumValue } from "@solyx/utils/is";

import { Secret } from "#shared/ipc/settings.ts";

import { ErrorAlert } from "../../components/error-alert.tsx";
import { LoadError } from "../../components/load-error.tsx";
import { LoadingState } from "../../components/loading-state.tsx";
import { OptionSelect } from "../../components/option-select.tsx";
import { Section } from "../../components/section.tsx";
import { RailedColumn } from "../../components/sheet.tsx";

import { AppSecretRow, SecretsUnavailable } from "./secret-row.tsx";
import { SettingsList, SettingsRow } from "./settings-list.tsx";
import { embeddingsSettingsQuery, secretsQuery } from "./settings-query.ts";

/** Experimental: news grouping that also joins items whose vectors read alike. */
export function EmbeddingsSettings() {
  const { t } = useTranslation();
  const settings = useQuery(embeddingsSettingsQuery());
  const secrets = useQuery(secretsQuery());

  const save = useMutation({
    mutationFn: (change: () => Promise<void>) => change(),
  });

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

  const { enabled, provider, space, measured } = settings.data;
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
                  save.mutate(() =>
                    window.solyx.settings.setEmbeddingsEnabled(next)
                  )
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
            description={t(
              `settings.embeddings.provider-descriptions.${provider}`
            )}
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
                    window.solyx.settings.setEmbeddingsProvider(next)
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
