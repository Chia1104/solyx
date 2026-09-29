import type { ErrorComponentProps } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { ErrorAlert } from "./error-alert.tsx";

/** Rendered by the router's error boundaries and any `CatchBoundary`; retrying renders the failed subtree again. */
export function ErrorFallback({ error, reset }: ErrorComponentProps) {
  const { t } = useTranslation();

  return (
    <ErrorAlert
      title={t("common.error-title")}
      description={error instanceof Error ? error.message : String(error)}
      onRetry={reset}
    />
  );
}
