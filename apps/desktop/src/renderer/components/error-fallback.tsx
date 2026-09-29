import type { ErrorComponentProps } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import * as z from "zod";

import { ErrorAlert } from "./error-alert.tsx";
import { FallbackFrame } from "./fallback-frame.tsx";

/**
 * Rendered by the router's error boundaries and any `CatchBoundary`, in the middle of the
 * region that failed; retrying renders the failed subtree again.
 */
export function ErrorFallback({ error, reset }: ErrorComponentProps) {
  const { t } = useTranslation();

  // A zod error's message is its issues as JSON, so they are listed instead.
  const description =
    error instanceof z.ZodError
      ? z.prettifyError(error)
      : error instanceof Error
        ? error.message
        : String(error);

  return (
    <FallbackFrame>
      <ErrorAlert
        title={t("common.error-title")}
        description={description}
        onRetry={reset}
      />
    </FallbackFrame>
  );
}
