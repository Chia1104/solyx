import { Switch } from "@heroui/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { AgentAuth, AgentThinking } from "@solyx/agent/providers";

import { AGENT_PROVIDER_SECRET } from "#shared/ipc/settings.ts";
import type { AgentProviderSettings } from "#shared/ipc/settings.ts";

import { ErrorAlert } from "../../components/error-alert.tsx";
import { LoadError } from "../../components/load-error.tsx";
import { LoadingState } from "../../components/loading-state.tsx";
import { OptionSelect } from "../../components/option-select.tsx";
import { Section } from "../../components/section.tsx";
import { RailedColumn } from "../../components/sheet.tsx";
import { ProviderMark } from "../agent/agent-provider-mark.tsx";

import { ChatGPTSignIn } from "./chatgpt-sign-in.tsx";
import { AppSecretRow, SecretsUnavailable } from "./secret-row.tsx";
import { SettingsList, SettingsRow } from "./settings-list.tsx";
import { agentSettingsQuery, secretsQuery } from "./settings-query.ts";

/**
 * The providers whose models conversations may pick and how each is paid for (a key, or a
 * subscription where the provider offers one), then the model new conversations start on and how
 * long it thinks.
 */
export function AgentSettings() {
  const { t } = useTranslation();
  const settings = useQuery(agentSettingsQuery());
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

  const { providers, provider, model, thinking, models } = settings.data;
  const { available, states } = secrets.data;

  const offered = models.filter((option) => option.provider === provider);
  const reasoning = offered.find((option) => option.id === model)?.reasoning;

  const providerLabel = t("settings.agent.default-provider");
  const modelLabel = t("settings.agent.model");
  const thinkingLabel = t("settings.agent.thinking");
  const authLabel = t("settings.agent.auth");

  const providerRows = (each: AgentProviderSettings) => {
    const name = t(`settings.agent.providers.${each.provider}`);
    const secret = AGENT_PROVIDER_SECRET[each.provider];
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
            <AppSecretRow
              secret={secret}
              state={states[secret]}
              available={available}
            />
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
          <p className="text-xs text-muted">
            {t("settings.agent.providers-description")}
          </p>
          {providers.map(providerRows)}
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
                      label: t(`settings.agent.providers.${each.provider}`),
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
