import type { ComponentProps } from "react";

import { useTranslation } from "react-i18next";

import { ErrorAlert } from "./error-alert.tsx";
import { RailedColumn } from "./sheet.tsx";

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

/** A section's load that failed, in the railed column its content would fill. */
export function SectionLoadError(props: ComponentProps<typeof LoadError>) {
  return (
    <RailedColumn className="px-6 py-5">
      <LoadError {...props} />
    </RailedColumn>
  );
}
