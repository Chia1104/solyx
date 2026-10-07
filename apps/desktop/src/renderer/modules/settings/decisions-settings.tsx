import { useId, useMemo, useState } from "react";

import cloudflare from "@lobehub/icons-static-svg/icons/cloudflare-color.svg?no-inline";
import openai from "@lobehub/icons-static-svg/icons/openai.svg?no-inline";
import { useMutation, useQuery } from "@tanstack/react-query";
import { TabList, TabPanel, Tabs } from "react-aria-components";
import { useTranslation } from "react-i18next";
import * as z from "zod";

import { DecisionsProvider } from "@solyx/decisions/provider";
import { isEnumValue } from "@solyx/utils/is";

import { DECISIONS_SECRETS, SecretState } from "#shared/ipc/settings.ts";
import type { DecisionsProviderSettings } from "#shared/ipc/settings.ts";

import { ErrorAlert } from "../../components/error-alert.tsx";
import { LoadError } from "../../components/load-error.tsx";
import { LoadingState } from "../../components/loading-state.tsx";
import { LogoMark } from "../../components/logo-mark.tsx";
import type { Logo } from "../../components/logo-mark.tsx";
import { OptionSelect } from "../../components/option-select.tsx";
import { Section } from "../../components/section.tsx";
import { RailedColumn } from "../../components/sheet.tsx";

import {
  PROVIDER_GRID,
  PROVIDER_PANEL,
  ProviderTile,
  TileTone,
} from "./provider-tile.tsx";
import { AppSecretRow, SecretsUnavailable } from "./secret-row.tsx";
import { SettingsList, SettingsRow } from "./settings-list.tsx";
import { decisionsSettingsQuery, secretsQuery } from "./settings-query.ts";
import { TextSettingRow } from "./text-setting-row.tsx";

const LOGOS: Partial<Record<DecisionsProvider, Logo>> = {
  [DecisionsProvider.Cloudflare]: { src: cloudflare, colored: true },
  [DecisionsProvider.OpenAI]: { src: openai, colored: false },
};

/**
 * The decisions providers, as a grid of tiles that each open below it with the provider's key,
 * model and endpoint, then the provider whose model scores news and posts.
 */
export function DecisionsSettings() {
  const { t } = useTranslation();
  const providersLabelId = useId();
  // The tile the user opened; until then, the provider in use.
  const [opened, setOpened] = useState<DecisionsProvider | null>(null);
  const settings = useQuery(decisionsSettingsQuery());
  const secrets = useQuery(secretsQuery());

  const setProvider = useMutation({
    mutationFn: (provider: DecisionsProvider) =>
      window.solyx.settings.setDecisionsProvider(provider),
  });

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
      accountId: z
        .string()
        .trim()
        .min(1, { error: t("settings.decisions.account-id-required") })
        .max(200),
    }),
    [t]
  );

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

  const { provider, providers } = settings.data;
  const { available, states } = secrets.data;
  const selected = opened ?? provider;
  const providerLabel = t("settings.decisions.provider");

  const tile = (each: DecisionsProviderSettings) => {
    const name = t(`settings.decisions.providers.${each.provider}`);

    const missing =
      states[DECISIONS_SECRETS[each.provider]] !== SecretState.Saved
        ? t("settings.decisions.provider-states.needs-key")
        : each.accountId === null
          ? t("settings.decisions.provider-states.needs-account")
          : undefined;

    return (
      <ProviderTile
        key={each.provider}
        id={each.provider}
        mark={
          <LogoMark
            logo={LOGOS[each.provider]}
            name={name}
            className="size-5"
          />
        }
        name={name}
        state={missing ?? t("settings.decisions.provider-states.ready")}
        tone={missing ? TileTone.Pencil : TileTone.Ink}
        badge={
          each.provider === provider
            ? t("settings.decisions.provider-in-use")
            : undefined
        }
      />
    );
  };

  const rows = (each: DecisionsProviderSettings) => {
    const secret = DECISIONS_SECRETS[each.provider];

    return (
      <SettingsList>
        <AppSecretRow
          secret={secret}
          state={states[secret]}
          available={available}
        />
        {each.accountId === undefined ? null : (
          <TextSettingRow
            label={t("settings.decisions.account-id")}
            description={t("settings.decisions.account-id-description")}
            value={each.accountId ?? ""}
            isDefault={each.accountId === null}
            schema={schemas.accountId}
            onSave={(next) => window.solyx.settings.setDecisionsAccountId(next)}
          />
        )}
        <TextSettingRow
          label={t("settings.decisions.model")}
          description={t(
            `settings.decisions.model-descriptions.${each.provider}`
          )}
          value={each.model}
          isDefault={each.model === each.defaults.model}
          schema={schemas.model}
          onSave={(next) =>
            window.solyx.settings.setDecisionsModel(each.provider, next)
          }
        />
        <TextSettingRow
          label={t("settings.decisions.base-url")}
          description={t("settings.decisions.base-url-description")}
          value={each.baseURL}
          isDefault={each.baseURL === each.defaults.baseURL}
          schema={schemas.baseURL}
          onSave={(next) =>
            window.solyx.settings.setDecisionsBaseURL(each.provider, next)
          }
        />
      </SettingsList>
    );
  };

  return (
    <Section
      title={t("settings.decisions.title")}
      description={t("settings.decisions.description")}>
      <div className="flex flex-col gap-3">
        {available ? null : <SecretsUnavailable />}
        <div className="flex flex-col gap-2">
          <p id={providersLabelId} className="text-xs text-muted">
            {t("settings.decisions.providers-description")}
          </p>
          <Tabs
            selectedKey={selected}
            onSelectionChange={(key) => {
              if (isEnumValue(DecisionsProvider, key)) setOpened(key);
            }}
            className="flex flex-col gap-3">
            <TabList
              aria-labelledby={providersLabelId}
              className={PROVIDER_GRID}>
              {providers.map(tile)}
            </TabList>
            {providers.map((each) => (
              <TabPanel
                key={each.provider}
                id={each.provider}
                className={PROVIDER_PANEL}>
                {rows(each)}
              </TabPanel>
            ))}
          </Tabs>
        </div>
        <div className="flex flex-col gap-2 pt-2">
          <p className="text-xs text-muted">
            {t("settings.decisions.in-use-description")}
          </p>
          <SettingsList>
            <SettingsRow
              label={providerLabel}
              actions={
                <OptionSelect
                  aria-label={providerLabel}
                  className="w-56"
                  value={provider}
                  isDisabled={setProvider.isPending}
                  options={providers.map((each) => ({
                    id: each.provider,
                    label: t(`settings.decisions.providers.${each.provider}`),
                  }))}
                  onChange={(next) => setProvider.mutate(next)}
                />
              }
            />
          </SettingsList>
        </div>
        {setProvider.error ? (
          <ErrorAlert
            title={t("settings.save-failed")}
            description={setProvider.error.message}
          />
        ) : null}
      </div>
    </Section>
  );
}
