import { Alert } from "@heroui/react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { Secret } from "#shared/ipc/settings.ts";

import { ErrorAlert } from "../../components/error-alert.tsx";
import { LoadingState } from "../../components/loading-state.tsx";

import { ApiKeyForm } from "./api-key-form.tsx";
import { secretsQuery } from "./secrets-query.ts";

export function ApiKeys() {
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
          <Alert.Title>{t("settings.api-keys.unavailable")}</Alert.Title>
        </Alert.Content>
      </Alert>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {Object.values(Secret).map((secret) => (
        <ApiKeyForm key={secret} secret={secret} state={data.states[secret]} />
      ))}
    </div>
  );
}
