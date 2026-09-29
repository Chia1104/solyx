import { Spinner } from "@heroui/react";
import { useTranslation } from "react-i18next";

/** Sized like HeroUI's `EmptyState`, so swapping between them does not shift the layout. */
export function LoadingState() {
  const { t } = useTranslation();

  return (
    <div
      role="status"
      className="flex items-center gap-2 p-2 text-sm text-muted">
      <Spinner size="sm" color="current" />
      {t("common.loading")}
    </div>
  );
}
