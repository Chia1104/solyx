import { buttonVariants } from "@heroui/styles";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { FallbackFrame } from "./fallback-frame.tsx";

/** Where an address that leads nowhere lands, with the way back to the overview. */
export function NotFound() {
  const { t } = useTranslation();

  return (
    <FallbackFrame>
      <div className="flex flex-col items-center gap-3 text-center">
        <h1 className="text-base font-semibold">
          {t("common.not-found.title")}
        </h1>
        <p className="text-sm text-muted">
          {t("common.not-found.description")}
        </p>
        <Link
          to="/"
          className={buttonVariants({ size: "sm", variant: "secondary" })}>
          {t("common.not-found.action")}
        </Link>
      </div>
    </FallbackFrame>
  );
}
