import type { ComponentProps } from "react";

import { useTranslation } from "react-i18next";

import { ErrorAlert } from "./error-alert.tsx";

/** A load that failed, offering to try it again; what modules show where `LoadingState` was. */
export function LoadError({
  error,
  onRetry,
}: {
  error: Error;
  onRetry: () => void;
}) {
  const { t } = useTranslation();

  return (
    <ErrorAlert
      title={t("common.load-failed")}
      description={error.message}
      onRetry={onRetry}
    />
  );
}

/** A section's load that failed, on the sheet its content would fill. */
export function SectionLoadError(props: ComponentProps<typeof LoadError>) {
  return (
    <div className="sheet px-5 py-4">
      <LoadError {...props} />
    </div>
  );
}
