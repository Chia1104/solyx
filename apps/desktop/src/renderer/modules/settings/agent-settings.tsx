import { useId, useMemo, useState } from "react";

import { Switch, cn } from "@heroui/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { TabList, TabPanel, Tabs } from "react-aria-components";
import { useTranslation } from "react-i18next";
import * as z from "zod";

import { AgentAuth, AgentThinking } from "@solyx/agent/providers";
import type { AgentProvider } from "@solyx/agent/providers";
import { DecisionMode } from "@solyx/core/council";

import type { AgentProviderSettings } from "#shared/ipc/settings.ts";

import { ErrorAlert } from "../../components/error-alert.tsx";
import { LoadError } from "../../components/load-error.tsx";
import { LoadingState } from "../../components/loading-state.tsx";
import { OptionSelect } from "../../components/option-select.tsx";
import { Section } from "../../components/section.tsx";
import { RailedColumn } from "../../components/sheet.tsx";
import { ProviderMark } from "../agent/agent-provider-mark.tsx";

import { AddAgentProvider } from "./add-agent-provider.tsx";
import { ChatGPTSignIn } from "./chatgpt-sign-in.tsx";
import {
  PROVIDER_GRID,
  PROVIDER_PANEL,
  ProviderTile,
  TileTone,
} from "./provider-tile.tsx";
import { SecretRow, SecretsUnavailable } from "./secret-row.tsx";
import { SettingsList, SettingsRow } from "./settings-list.tsx";
import { agentSettingsQuery, secretsQuery } from "./settings-query.ts";
import { TextSettingRow } from "./text-setting-row.tsx";

/**
 * A provider's tile: drawn quiet while switched off, in pencil while switched on but unable to run
 * for want of a key or sign-in, and in ink once its models can run.
 */
function ProviderTab({
  settings,
  isDefault,
}: {
  settings: AgentProviderSettings;
  isDefault: boolean;
}) {
  const { t } = useTranslation();
  const { provider, name, enabled, usable, auth } = settings;

  const state = !enabled
    ? t("settings.agent.provider-states.off")
    : usable
      ? t("settings.agent.provider-states.ready")
      : auth === AgentAuth.Subscription
        ? t("settings.agent.provider-states.needs-sign-in")
        : t("settings.agent.provider-states.needs-key");

  return (
    <ProviderTile
      id={provider}
      mark={
        <ProviderMark
          provider={provider}
          className={cn("size-5", !enabled && "opacity-60 grayscale")}
        />
      }
      name={name}
      state={state}
      tone={!enabled ? TileTone.Quiet : usable ? TileTone.Ink : TileTone.Pencil}
      badge={isDefault ? t("settings.agent.provider-default") : undefined}
    />
  );
}

/**
 * The providers whose models conversations may pick, as a grid of tiles that each open below it
 * with how the provider is paid for (a key, or a subscription where the provider offers one),
 * then the model new conversations start on and how long it thinks.
 */
export function AgentSettings() {
  const { t } = useTranslation();
  const providersLabelId = useId();
  // The tile the user opened; until then, or once it leaves the page, the default provider's.
  const [opened, setOpened] = useState<AgentProvider | null>(null);
  const settings = useQuery(agentSettingsQuery());
  const secrets = useQuery(secretsQuery());

  const save = useMutation({
    mutationFn: (change: () => Promise<void>) => change(),
  });

  // Rebuilt per language so field errors come out localized.
  const endpointSchema = useMemo(
    () =>
      z
        .string()
        .trim()
        .pipe(
          z.url({
            protocol: /^https?$/,
            error: t("settings.agent.endpoint-invalid"),
          })
        ),
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

  const { providers, provider, model, thinking, decisionMode, models } =
    settings.data;

  const { available } = secrets.data;

  const shown = providers.filter((each) => each.listed);
  const hidden = providers.filter((each) => !each.listed);

  const selected =
    shown.find((each) => each.provider === opened)?.provider ?? provider;

  const offered = models.filter((option) => option.provider === provider);
  const reasoning = offered.find((option) => option.id === model)?.reasoning;

  const providerLabel = t("settings.agent.default-provider");
  const modelLabel = t("settings.agent.model");
  const thinkingLabel = t("settings.agent.thinking");
  const decisionModeLabel = t("settings.agent.decision-mode");
  const authLabel = t("settings.agent.auth");
  const endpointLabel = t("settings.agent.endpoint");

  const providerRows = (each: AgentProviderSettings) => {
    const { name } = each;
    const keyLabel = t("settings.agent.key-label", { provider: name });
    const isDefault = each.provider === provider;

    return (
      <SettingsList key={each.provider}>
        <SettingsRow
          label={
            <span className="flex items-center gap-2">
              <ProviderMark provider={each.provider} />
              {name}
            </span>
          }
          description={
            isDefault ? t("settings.agent.provider-is-default") : undefined
          }
          actions={
            <Switch
              isSelected={each.enabled}
              // The default model's provider cannot be switched off.
              isDisabled={save.isPending || isDefault}
              onChange={(enabled) =>
                save.mutate(() =>
                  window.solyx.settings.setAgentProviderEnabled(
                    each.provider,
                    enabled
                  )
                )
              }>
              <Switch.Content>
                <Switch.Control>
                  <Switch.Thumb />
                </Switch.Control>
                <span className="sr-only">
                  {t("settings.agent.enable-provider", { provider: name })}
                </span>
              </Switch.Content>
            </Switch>
          }
        />
        {each.enabled && each.subscription ? (
          <SettingsRow
            label={authLabel}
            description={t("settings.agent.auth-description")}
            actions={
              <OptionSelect
                aria-label={authLabel}
                className="w-56"
                value={each.auth}
                isDisabled={save.isPending}
                options={Object.values(AgentAuth).map((id) => ({
                  id,
                  label: t(`settings.agent.auths.${id}`),
                }))}
                onChange={(next) =>
                  save.mutate(() => window.solyx.settings.setAgentAuth(next))
                }
              />
            }
          />
        ) : null}
        {each.enabled ? (
          each.subscription && each.auth === AgentAuth.Subscription ? (
            <ChatGPTSignIn signedIn={each.subscription.signedIn} />
          ) : (
            <>
              <SecretRow
                label={keyLabel}
                fieldLabel={keyLabel}
                description={t("settings.agent.key-hint", { provider: name })}
                state={each.key}
                available={available}
                onSave={(value) =>
                  window.solyx.settings.saveAgentKey(each.provider, value)
                }
                onRemove={() =>
                  window.solyx.settings.deleteAgentKey(each.provider)
                }
              />
              {each.endpoint ? (
                <TextSettingRow
                  label={endpointLabel}
                  description={t("settings.agent.endpoint-description")}
                  value={each.endpoint.url}
                  isDefault={each.endpoint.url === each.endpoint.default}
                  schema={endpointSchema}
                  onSave={(next) =>
                    window.solyx.settings.setAgentEndpoint(each.provider, next)
                  }
                />
              ) : null}
            </>
          )
        ) : null}
      </SettingsList>
    );
  };

  return (
    <Section
      title={t("settings.agent.title")}
      description={t("settings.agent.description")}>
      <div className="flex flex-col gap-3">
        {available ? null : <SecretsUnavailable />}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <p id={providersLabelId} className="text-xs text-muted">
              {t("settings.agent.providers-description")}
            </p>
            <AddAgentProvider
              providers={hidden}
              isDisabled={save.isPending}
              onAdd={(added) => {
                setOpened(added);
                save.mutate(() =>
                  window.solyx.settings.setAgentProviderEnabled(added, true)
                );
              }}
            />
          </div>
          <Tabs
            selectedKey={selected}
            onSelectionChange={(key) => {
              const tile = shown.find((each) => each.provider === key);

              if (tile) setOpened(tile.provider);
            }}
            className="flex flex-col gap-3">
            <TabList
              aria-labelledby={providersLabelId}
              className={PROVIDER_GRID}>
              {shown.map((each) => (
                <ProviderTab
                  key={each.provider}
                  settings={each}
                  isDefault={each.provider === provider}
                />
              ))}
            </TabList>
            {shown.map((each) => (
              <TabPanel
                key={each.provider}
                id={each.provider}
                className={PROVIDER_PANEL}>
                {providerRows(each)}
              </TabPanel>
            ))}
          </Tabs>
        </div>
        <div className="flex flex-col gap-2 pt-2">
          <p className="text-xs text-muted">
            {t("settings.agent.default-description")}
          </p>
          <SettingsList>
            <SettingsRow
              label={providerLabel}
              actions={
                <OptionSelect
                  aria-label={providerLabel}
                  className="w-56"
                  value={provider}
                  isDisabled={save.isPending}
                  options={providers
                    .filter((each) => each.enabled)
                    .map((each) => ({
                      id: each.provider,
                      label: each.name,
                    }))}
                  onChange={(next) =>
                    save.mutate(() =>
                      window.solyx.settings.setAgentProvider(next)
                    )
                  }
                />
              }
            />
            <SettingsRow
              label={modelLabel}
              description={t("settings.agent.model-description")}
              actions={
                <OptionSelect
                  aria-label={modelLabel}
                  className="w-56"
                  value={model}
                  isDisabled={save.isPending}
                  options={offered.map((option) => ({
                    id: option.id,
                    label: option.name,
                  }))}
                  onChange={(next) =>
                    save.mutate(() => window.solyx.settings.setAgentModel(next))
                  }
                />
              }
            />
            <SettingsRow
              label={thinkingLabel}
              description={t("settings.agent.thinking-description")}
              actions={
                <OptionSelect
                  aria-label={thinkingLabel}
                  className="w-56"
                  value={thinking}
                  isDisabled={save.isPending || reasoning === false}
                  options={Object.values(AgentThinking).map((id) => ({
                    id,
                    label: t(`settings.agent.thinkings.${id}`),
                  }))}
                  onChange={(next) =>
                    save.mutate(() =>
                      window.solyx.settings.setAgentThinking(next)
                    )
                  }
                />
              }
            />
            <SettingsRow
              label={decisionModeLabel}
              description={t("settings.agent.decision-mode-description")}
              actions={
                <OptionSelect
                  aria-label={decisionModeLabel}
                  className="w-56"
                  value={decisionMode}
                  isDisabled={save.isPending}
                  options={Object.values(DecisionMode).map((id) => ({
                    id,
                    label: t(`settings.agent.decision-modes.${id}`),
                  }))}
                  onChange={(next) =>
                    save.mutate(() =>
                      window.solyx.settings.setAgentDecisionMode(next)
                    )
                  }
                />
              }
            />
          </SettingsList>
        </div>
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
