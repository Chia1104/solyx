import { ListBox, Select } from "@heroui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { AgentProvider, AgentThinking } from "@solyx/agent/providers";
import { isEnumValue } from "@solyx/utils/is";

import { AGENT_PROVIDER_SECRET } from "#shared/ipc/settings.ts";

import { ErrorAlert } from "../../components/error-alert.tsx";
import { LoadingState } from "../../components/loading-state.tsx";
import { Section } from "../../components/section.tsx";
import { RailedColumn } from "../../components/sheet.tsx";

import { SecretRow, SecretsUnavailable } from "./secret-row.tsx";
import { SettingsList, SettingsRow } from "./settings-list.tsx";
import {
  agentSettingsQuery,
  secretsQuery,
  settingsQueryKeys,
} from "./settings-query.ts";

interface Option {
  id: string;
  label: string;
}

function OptionSelect({
  label,
  value,
  options,
  isDisabled,
  onChange,
}: {
  label: string;
  value: string;
  options: Option[];
  isDisabled: boolean;
  onChange: (id: string) => void;
}) {
  return (
    <Select
      aria-label={label}
      className="w-56"
      value={value}
      isDisabled={isDisabled}
      onChange={(key) => {
        const next = options.find((option) => option.id === key);

        if (next && next.id !== value) onChange(next.id);
      }}>
      <Select.Trigger>
        <Select.Value />
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover>
        <ListBox>
          {options.map((option) => (
            <ListBox.Item
              key={option.id}
              id={option.id}
              textValue={option.label}>
              {option.label}
              <ListBox.ItemIndicator />
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}

/** Whose model runs the agent, which one, how long it thinks, and the key it runs on. */
export function AgentSettings() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const settings = useQuery(agentSettingsQuery());
  const secrets = useQuery(secretsQuery());

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: settingsQueryKeys.agent });

  const save = useMutation({
    mutationFn: (change: () => Promise<void>) => change(),
    onSettled: refresh,
  });

  const error = settings.error ?? secrets.error;

  if (error) {
    return (
      <RailedColumn className="px-6 py-5">
        <ErrorAlert
          title={t("common.load-failed")}
          description={error.message}
          onRetry={() => {
            void settings.refetch();
            void secrets.refetch();
          }}
        />
      </RailedColumn>
    );
  }

  if (!settings.data || !secrets.data) return <LoadingState />;

  const { provider, model, thinking, models } = settings.data;
  const { available, states } = secrets.data;
  const secret = AGENT_PROVIDER_SECRET[provider];
  const reasoning = models.find((option) => option.id === model)?.reasoning;

  const providerLabel = t("settings.agent.provider");
  const modelLabel = t("settings.agent.model");
  const thinkingLabel = t("settings.agent.thinking");

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
                label={providerLabel}
                value={provider}
                isDisabled={save.isPending}
                options={Object.values(AgentProvider).map((id) => ({
                  id,
                  label: t(`settings.agent.providers.${id}`),
                }))}
                onChange={(next) => {
                  if (isEnumValue(AgentProvider, next)) {
                    save.mutate(() =>
                      window.solyx.settings.setAgentProvider(next)
                    );
                  }
                }}
              />
            }
          />
          <SecretRow
            secret={secret}
            state={states[secret]}
            available={available}
          />
          <SettingsRow
            label={modelLabel}
            description={t("settings.agent.model-description")}
            actions={
              <OptionSelect
                label={modelLabel}
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
                label={thinkingLabel}
                value={thinking}
                isDisabled={save.isPending || reasoning === false}
                options={Object.values(AgentThinking).map((id) => ({
                  id,
                  label: t(`settings.agent.thinkings.${id}`),
                }))}
                onChange={(next) => {
                  if (isEnumValue(AgentThinking, next)) {
                    save.mutate(() =>
                      window.solyx.settings.setAgentThinking(next)
                    );
                  }
                }}
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
