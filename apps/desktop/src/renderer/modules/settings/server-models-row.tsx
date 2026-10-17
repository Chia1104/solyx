import { Button } from "@heroui/react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import type { AgentProvider } from "@solyx/agent/providers";

import { ErrorAlert } from "../../components/error-alert.tsx";

import { SettingsRow } from "./settings-list.tsx";
import { agentServerModelsQuery } from "./settings-query.ts";

/** How many models a server the user runs holds that can run the agent, asked again on request. */
export function ServerModelsRow({
  provider,
  name,
}: {
  provider: AgentProvider;
  name: string;
}) {
  const { t } = useTranslation();

  const { data, error, isFetching, refetch } = useQuery(
    agentServerModelsQuery(provider)
  );

  const failure = data?.failure ?? error?.message;

  return (
    <SettingsRow
      label={t("settings.agent.server-models")}
      description={t("settings.agent.server-models-description")}
      value={
        data === undefined
          ? t("settings.agent.server-models-checking")
          : data.models > 0
            ? t("settings.agent.server-models-count", { count: data.models })
            : t("settings.agent.server-models-none")
      }
      actions={
        <Button
          size="sm"
          variant="secondary"
          isPending={isFetching}
          onPress={() => void refetch()}>
          {t("settings.agent.list-models")}
        </Button>
      }>
      {failure ? (
        <ErrorAlert
          title={t("settings.agent.server-unreachable", { provider: name })}
          description={failure}
        />
      ) : null}
    </SettingsRow>
  );
}
