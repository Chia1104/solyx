import { useId, useMemo, useState } from "react";
import type { ReactNode } from "react";

import { Switch, cn } from "@heroui/react";
import { BotIcon, Key01Icon, UserCircleIcon } from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@hugeicons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { TabList, TabPanel, Tabs } from "react-aria-components";
import { useTranslation } from "react-i18next";

import { AgentAuth, AgentThinking } from "@solyx/agent/providers";
import type { AgentProvider } from "@solyx/agent/providers";
import { SecretState, endpointSchema } from "@solyx/api/settings";
import type { AgentProviderSettings } from "@solyx/api/settings";
import { DecisionMode, MagiUnit } from "@solyx/core/council";

import { client, orpc } from "../../app/rpc.ts";
import { ErrorAlert } from "../../components/error-alert.tsx";
import { Icon } from "../../components/icon.tsx";
import { SectionLoadError } from "../../components/load-error.tsx";
import { LoadingState } from "../../components/loading-state.tsx";
import { LogoMark } from "../../components/logo-mark.tsx";
import { OptionSelect } from "../../components/option-select.tsx";
import { Section } from "../../components/section.tsx";
import { AgentModelPicker } from "../agent/agent-model-picker.tsx";
import { ProviderMark } from "../agent/agent-provider-mark.tsx";

import { AddAgentProvider } from "./add-agent-provider.tsx";
import { KeySignIn } from "./key-sign-in.tsx";
import { matching } from "./matching.ts";
import nerv from "./nerv.svg?no-inline";
import {
  PROVIDER_GRID,
  PROVIDER_PANEL,
  ProviderTile,
  TileTone,
} from "./provider-tile.tsx";
import { SecretRow, SecretsUnavailable } from "./secret-row.tsx";
import { ServerModelsRow } from "./server-models-row.tsx";
import { SettingsList, SettingsRow } from "./settings-list.tsx";
import { agentSettingsQuery, secretsQuery } from "./settings-query.ts";
import { SubscriptionSignIn } from "./subscription-sign-in.tsx";
import { TextSettingRow } from "./text-setting-row.tsx";

const AUTH_ICON: Record<AgentAuth, IconSvgElement> = {
  [AgentAuth.ApiKey]: Key01Icon,
  [AgentAuth.Subscription]: UserCircleIcon,
};

// The MAGI are NERV's, so they carry its leaf, in the text's colour like the agent beside them.
const DECISION_MODE_ICON: Record<DecisionMode, ReactNode> = {
  [DecisionMode.Single]: <Icon icon={BotIcon} />,
  [DecisionMode.Magi]: (
    <LogoMark logo={{ src: nerv, colored: false }} name="MAGI" />
  ),
};

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
  const { provider, name, enabled, usable, auth, server } = settings;

  const state = !enabled
    ? t("settings.agent.provider-states.off")
    : usable
      ? t("settings.agent.provider-states.ready")
      : server
        ? server.failure
          ? t("settings.agent.provider-states.unreachable")
          : t("settings.agent.provider-states.no-models")
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
  const queryClient = useQueryClient();
  const settings = useQuery(agentSettingsQuery());
  const secrets = useQuery(secretsQuery());

  const save = useMutation({
    mutationFn: (change: () => Promise<void>) => change(),
  });

  // Rebuilt per language so field errors come out localized.
  const endpointFieldSchema = useMemo(
    () => matching(endpointSchema, t("settings.agent.endpoint-invalid")),
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

  const { providers, provider, model, thinking, decisionMode, magi, models } =
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
                  client.settings.setAgentProviderEnabled({
                    provider: each.provider,
                    enabled,
                  })
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
        {each.enabled && each.subscription && !each.subscription.only ? (
          <SettingsRow
            label={authLabel}
            description={t("settings.agent.auth-description")}
            actions={
              <OptionSelect
                aria-label={authLabel}
                className="w-56"
                value={each.auth}
                isDisabled={save.isPending}
                options={[
                  {
                    id: AgentAuth.ApiKey,
                    label: t("settings.agent.auths.api-key"),
                    icon: <Icon icon={AUTH_ICON[AgentAuth.ApiKey]} />,
                  },
                  {
                    id: AgentAuth.Subscription,
                    label: t("settings.agent.auths.subscription", {
                      plan: each.subscription.plan,
                    }),
                    icon: <Icon icon={AUTH_ICON[AgentAuth.Subscription]} />,
                  },
                ]}
                onChange={(next) =>
                  save.mutate(() =>
                    client.settings.setAgentAuth({
                      provider: each.provider,
                      auth: next,
                    })
                  )
                }
              />
            }
          />
        ) : null}
        {each.enabled ? (
          each.server ? (
            <>
              {each.endpoint ? (
                <TextSettingRow
                  label={endpointLabel}
                  description={t("settings.agent.server-endpoint-description", {
                    provider: name,
                  })}
                  value={each.endpoint.url}
                  isDefault={each.endpoint.url === each.endpoint.default}
                  schema={endpointFieldSchema}
                  onSave={(next) =>
                    client.settings.setAgentEndpoint({
                      provider: each.provider,
                      endpoint: next,
                    })
                  }
                />
              ) : null}
              <SecretRow
                label={
                  <>
                    {keyLabel}{" "}
                    <span className="font-normal text-muted">
                      {t("settings.secrets.optional")}
                    </span>
                  </>
                }
                fieldLabel={keyLabel}
                description={t("settings.agent.server-key-hint", {
                  provider: name,
                })}
                state={each.key}
                available={available}
                onSave={(value) =>
                  client.settings.saveAgentKey({
                    provider: each.provider,
                    value,
                  })
                }
                onRemove={() => client.settings.deleteAgentKey(each.provider)}
              />
              <ServerModelsRow provider={each.provider} name={name} />
            </>
          ) : each.subscription && each.auth === AgentAuth.Subscription ? (
            <SubscriptionSignIn
              provider={each.provider}
              name={name}
              plan={each.subscription.plan}
              signedIn={each.subscription.signedIn}
            />
          ) : (
            <>
              <SecretRow
                label={keyLabel}
                fieldLabel={keyLabel}
                description={t("settings.agent.key-hint", { provider: name })}
                state={each.key}
                available={available}
                onSave={(value) =>
                  client.settings.saveAgentKey({
                    provider: each.provider,
                    value,
                  })
                }
                onRemove={() => client.settings.deleteAgentKey(each.provider)}
              />
              {each.createsKey && each.key !== SecretState.Saved ? (
                <KeySignIn provider={each.provider} name={name} />
              ) : null}
              {each.endpoint ? (
                <TextSettingRow
                  label={endpointLabel}
                  description={t("settings.agent.endpoint-description")}
                  value={each.endpoint.url}
                  isDefault={each.endpoint.url === each.endpoint.default}
                  schema={endpointFieldSchema}
                  onSave={(next) =>
                    client.settings.setAgentEndpoint({
                      provider: each.provider,
                      endpoint: next,
                    })
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
                  client.settings.setAgentProviderEnabled({
                    provider: added,
                    enabled: true,
                  })
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
                      icon: <ProviderMark provider={each.provider} />,
                    }))}
                  onChange={(next) =>
                    save.mutate(() => client.settings.setAgentProvider(next))
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
                    save.mutate(() => client.settings.setAgentModel(next))
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
                    save.mutate(() => client.settings.setAgentThinking(next))
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
                    icon: DECISION_MODE_ICON[id],
                  }))}
                  onChange={(next) =>
                    save.mutate(() =>
                      client.settings.setAgentDecisionMode(next)
                    )
                  }
                />
              }
            />
            {decisionMode === DecisionMode.Magi
              ? Object.values(MagiUnit).map((unit) => {
                  const label = t(`settings.agent.magi.units.${unit}`);

                  return (
                    <SettingsRow
                      key={unit}
                      label={label}
                      description={t(`settings.agent.magi.personas.${unit}`)}
                      actions={
                        <AgentModelPicker
                          aria-label={label}
                          settings={settings.data}
                          pick={{ model: magi[unit], thinking: null }}
                          fallback={t("settings.agent.magi.conversation-model")}
                          thinks={false}
                          placement="bottom end"
                          onChange={(next) =>
                            // Settles on the refetched settings, so the picker never shows the old model.
                            save.mutateAsync(async () => {
                              await client.settings.setMagiModel({
                                unit,
                                model: next.model,
                              });
                              // Joins the read the settings push started.
                              await queryClient.invalidateQueries(
                                { queryKey: orpc.settings.agent.key() },
                                { cancelRefetch: false }
                              );
                            })
                          }
                        />
                      }
                    />
                  );
                })
              : null}
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
