import { Alert } from "@heroui/react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import type { Secret } from "#shared/ipc/settings.ts";

import { ErrorAlert } from "../../components/error-alert.tsx";
import { LoadingState } from "../../components/loading-state.tsx";

import { SecretForm } from "./secret-form.tsx";
import { secretsQuery } from "./settings-query.ts";

/** One form per secret a source needs, or why none can be saved on this computer. */
export function SecretFields({ secrets }: { secrets: Secret[] }) {
  const { t } = useTranslation();
  const { data, error, refetch } = useQuery(secretsQuery());

  if (error) {
    return (
      <ErrorAlert
        title={t("common.load-failed")}
        description={error.message}
        onRetry={() => void refetch()}
      />
    );
  }

  if (!data) return <LoadingState />;

  if (!data.available) {
    return (
      <Alert status="warning">
        <Alert.Indicator />
        <Alert.Content>
          <Alert.Title>{t("settings.secrets.unavailable")}</Alert.Title>
        </Alert.Content>
      </Alert>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {secrets.map((secret) => (
        <SecretForm key={secret} secret={secret} state={data.states[secret]} />
      ))}
    </div>
  );
}
