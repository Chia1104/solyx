import { useEffect } from "react";

import { Button } from "@heroui/react";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { orpc } from "../../app/rpc.ts";
import { ErrorAlert } from "../../components/error-alert.tsx";

import { SettingsRow } from "./settings-list.tsx";

/**
 * How many models a server the user runs holds that can run the agent, listed again as the row
 * opens, since a model pulled in a terminal tells the app nothing, and whenever the user asks.
 */
export function ServerModelsRow({
  name,
  count,
  failure,
}: {
  name: string;
  count: number;
  /** Why the server failed to list them when last asked. */
  failure: string | null;
}) {
  const { t } = useTranslation();

  const list = useMutation(
    orpc.settings.listAgentServerModels.mutationOptions()
  );

  const { mutate } = list;

  useEffect(() => mutate(), [mutate]);

  return (
    <SettingsRow
      label={t("settings.agent.server-models")}
      description={t("settings.agent.server-models-description")}
      value={
        count > 0
          ? t("settings.agent.server-models-count", { count })
          : t("settings.agent.server-models-none")
      }
      actions={
        <Button
          size="sm"
          variant="secondary"
          isPending={list.isPending}
          onPress={() => mutate()}>
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
