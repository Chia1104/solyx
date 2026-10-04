import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import {
  AgentAuth,
  AgentProvider,
  AgentThinking,
} from "@solyx/agent/providers";

import { AGENT_PROVIDER_SECRET } from "#shared/ipc/settings.ts";

import { ErrorAlert } from "../../components/error-alert.tsx";
import { LoadError } from "../../components/load-error.tsx";
import { LoadingState } from "../../components/loading-state.tsx";
import { OptionSelect } from "../../components/option-select.tsx";
import { Section } from "../../components/section.tsx";
import { RailedColumn } from "../../components/sheet.tsx";

import { ChatGPTSignIn } from "./chatgpt-sign-in.tsx";
import { AppSecretRow, SecretsUnavailable } from "./secret-row.tsx";
import { SettingsList, SettingsRow } from "./settings-list.tsx";
import { agentSettingsQuery, secretsQuery } from "./settings-query.ts";

/**
 * Whose model runs the agent and how it is paid for (a key, or a subscription where the provider
 * offers one), which model, and how long it thinks.
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

  const { provider, model, thinking, auth, subscription, models } =
    settings.data;

  const { available, states } = secrets.data;
  const secret = AGENT_PROVIDER_SECRET[provider];
  const reasoning = models.find((option) => option.id === model)?.reasoning;

  const providerLabel = t("settings.agent.provider");
  const modelLabel = t("settings.agent.model");
  const thinkingLabel = t("settings.agent.thinking");
  const authLabel = t("settings.agent.auth");

  return (
    <Section
      title={t("settings.agent.title")}
      description={t("settings.agent.description")}>
      <div className="flex flex-col gap-3">
        {available ? null : <SecretsUnavailable />}
        <SettingsList>
          <SettingsRow
            label={providerLabel}
            actions={
              <OptionSelect
                aria-label={providerLabel}
                className="w-56"
                value={provider}
                isDisabled={save.isPending}
                options={Object.values(AgentProvider).map((id) => ({
                  id,
                  label: t(`settings.agent.providers.${id}`),
                }))}
                onChange={(next) =>
                  save.mutate(() =>
                    window.solyx.settings.setAgentProvider(next)
                  )
                }
              />
            }
          />
          {subscription ? (
            <SettingsRow
              label={authLabel}
              description={t("settings.agent.auth-description")}
              actions={
                <OptionSelect
                  aria-label={authLabel}
                  className="w-56"
                  value={auth}
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
          {subscription && auth === AgentAuth.Subscription ? (
            <ChatGPTSignIn signedIn={subscription.signedIn} />
          ) : (
            <AppSecretRow
              secret={secret}
              state={states[secret]}
              available={available}
            />
          )}
          <SettingsRow
            label={modelLabel}
            description={t("settings.agent.model-description")}
            actions={
              <OptionSelect
                aria-label={modelLabel}
                className="w-56"
                value={model}
                isDisabled={save.isPending}
                options={models.map((option) => ({
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
