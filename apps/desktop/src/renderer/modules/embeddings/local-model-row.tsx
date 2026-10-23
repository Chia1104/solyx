import { Button, ProgressBar } from "@heroui/react";
import { buttonVariants } from "@heroui/styles";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { LocalModelStatus } from "@solyx/api/embeddings";
import { formatBytes } from "@solyx/utils/format";

import { orpc } from "../../app/rpc.ts";
import { ErrorAlert } from "../../components/error-alert.tsx";
import { SettingsRow } from "../settings/settings-list.tsx";

import { localModelQuery } from "./embeddings-query.ts";

const OLLAMA_DOWNLOAD_URL = "https://ollama.com/download";

/** Whether Ollama holds the model the settings name, and downloading it into Ollama where it does not. */
export function LocalModelRow() {
  const { t, i18n } = useTranslation();
  const { data, error, refetch } = useQuery(localModelQuery());
  const pull = useMutation(orpc.embeddings.pullLocalModel.mutationOptions());

  const label = t("settings.embeddings.local-model.title");
  const bytes = (value: number) => formatBytes(value, i18n.language);

  if (error) {
    return (
      <SettingsRow
        label={label}
        value={t("settings.embeddings.local-model.status.failed")}>
        <ErrorAlert
          title={t("settings.embeddings.local-model.status.failed")}
          description={error.message}
          onRetry={() => void refetch()}
        />
      </SettingsRow>
    );
  }

  if (!data) {
    return (
      <SettingsRow
        label={label}
        value={t("settings.embeddings.local-model.status.checking")}
      />
    );
  }

  const value = t(`settings.embeddings.local-model.status.${data.status}`);

  switch (data.status) {
    case LocalModelStatus.Unreachable:
      return (
        <SettingsRow
          label={label}
          description={t("settings.embeddings.local-model.unreachable", {
            host: data.host,
          })}
          value={value}
          actions={
            <a
              href={OLLAMA_DOWNLOAD_URL}
              target="_blank"
              rel="noreferrer"
              className={buttonVariants({ size: "sm", variant: "secondary" })}>
              {t("settings.embeddings.local-model.get-ollama")}
            </a>
          }
        />
      );

    case LocalModelStatus.Missing: {
      const failure = data.failure ?? pull.error?.message;

      return (
        <SettingsRow
          label={label}
          description={t("settings.embeddings.local-model.missing", {
            model: data.model,
            command: `ollama pull ${data.model}`,
          })}
          value={value}
          actions={
            <Button
              size="sm"
              variant="secondary"
              isPending={pull.isPending}
              onPress={() => pull.mutate()}>
              {t("settings.embeddings.local-model.pull")}
            </Button>
          }>
          {failure ? (
            <ErrorAlert
              title={t("settings.embeddings.local-model.pull-failed")}
              description={failure}
            />
          ) : null}
        </SettingsRow>
      );
    }

    case LocalModelStatus.Pulling:
      return (
        <SettingsRow
          label={label}
          description={t("settings.embeddings.local-model.pulling")}
          value={value}>
          <ProgressBar
            size="sm"
            color="default"
            aria-label={t("settings.embeddings.local-model.pulling-model", {
              model: data.model,
            })}
            isIndeterminate={data.total === 0}
            value={data.completed}
            maxValue={Math.max(data.total, 1)}
            valueLabel={
              data.total === 0
                ? t("settings.embeddings.local-model.starting")
                : t("settings.embeddings.local-model.progress", {
                    completed: bytes(data.completed),
                    total: bytes(data.total),
                  })
            }>
            <ProgressBar.Output className="text-xs text-muted tabular-nums" />
            <ProgressBar.Track>
              <ProgressBar.Fill />
            </ProgressBar.Track>
          </ProgressBar>
        </SettingsRow>
      );

    case LocalModelStatus.Ready:
      return <SettingsRow label={label} value={value} />;
  }
}
