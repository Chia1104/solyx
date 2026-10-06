import { useId, useState } from "react";

import exa from "@lobehub/icons-static-svg/icons/exa.svg?no-inline";
import firecrawl from "@lobehub/icons-static-svg/icons/firecrawl-color.svg?no-inline";
import { useMutation, useQuery } from "@tanstack/react-query";
import { TabList, TabPanel, Tabs } from "react-aria-components";
import { useTranslation } from "react-i18next";

import { isEnumValue } from "@solyx/utils/is";
import { WebSearchProvider } from "@solyx/web-search/provider";

import { SecretState } from "#shared/ipc/settings.ts";

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
import { SecretRow, SecretsUnavailable } from "./secret-row.tsx";
import { SettingsList, SettingsRow } from "./settings-list.tsx";
import { secretsQuery, webSearchSettingsQuery } from "./settings-query.ts";

const LOGOS: Record<WebSearchProvider, Logo> = {
  [WebSearchProvider.Firecrawl]: { src: firecrawl, colored: true },
  [WebSearchProvider.Exa]: { src: exa, colored: false },
};

/**
 * The web search vendors, as a grid of tiles that each open below it with the vendor's key, then
 * the vendor news and the agent search through.
 */
export function WebSearchSettings() {
  const { t } = useTranslation();
  const providersLabelId = useId();
  // The tile the user opened; until then, the vendor in use.
  const [opened, setOpened] = useState<WebSearchProvider | null>(null);
  const settings = useQuery(webSearchSettingsQuery());
  const secrets = useQuery(secretsQuery());

  const setProvider = useMutation({
    mutationFn: (provider: WebSearchProvider) =>
      window.solyx.settings.setWebSearchProvider(provider),
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

  const { provider, keys } = settings.data;
  const { available } = secrets.data;
  const providers = Object.values(WebSearchProvider);
  const selected = opened ?? provider;
  const providerLabel = t("settings.web-search.provider");
  const keyLabel = t("settings.web-search.key");

  return (
    <Section
      title={t("settings.web-search.title")}
      description={t("settings.web-search.description")}>
      <div className="flex flex-col gap-3">
        {available ? null : <SecretsUnavailable />}
        <div className="flex flex-col gap-2">
          <p id={providersLabelId} className="text-xs text-muted">
            {t("settings.web-search.providers-description")}
          </p>
          <Tabs
            selectedKey={selected}
            onSelectionChange={(key) => {
              if (isEnumValue(WebSearchProvider, key)) setOpened(key);
            }}
            className="flex flex-col gap-3">
            <TabList
              aria-labelledby={providersLabelId}
              className={PROVIDER_GRID}>
              {providers.map((each) => {
                const name = t(`settings.web-search.providers.${each}`);
                const ready = keys[each] === SecretState.Saved;

                return (
                  <ProviderTile
                    key={each}
                    id={each}
                    mark={
                      <LogoMark
                        logo={LOGOS[each]}
                        name={name}
                        className="size-5"
                      />
                    }
                    name={name}
                    state={t(
                      ready
                        ? "settings.web-search.provider-states.ready"
                        : "settings.web-search.provider-states.needs-key"
                    )}
                    tone={ready ? TileTone.Ink : TileTone.Pencil}
                    badge={
                      each === provider
                        ? t("settings.web-search.provider-in-use")
                        : undefined
                    }
                  />
                );
              })}
            </TabList>
            {providers.map((each) => (
              <TabPanel key={each} id={each} className={PROVIDER_PANEL}>
                <SettingsList>
                  <SecretRow
                    label={keyLabel}
                    fieldLabel={keyLabel}
                    description={t(`settings.web-search.key-hints.${each}`)}
                    state={keys[each]}
                    available={available}
                    onSave={(value) =>
                      window.solyx.settings.saveWebSearchKey(each, value)
                    }
                    onRemove={() =>
                      window.solyx.settings.deleteWebSearchKey(each)
                    }
                  />
                </SettingsList>
              </TabPanel>
            ))}
          </Tabs>
        </div>
        <div className="flex flex-col gap-2 pt-2">
          <p className="text-xs text-muted">
            {t("settings.web-search.in-use-description")}
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
                    id: each,
                    label: t(`settings.web-search.providers.${each}`),
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
