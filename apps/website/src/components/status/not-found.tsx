import { Link } from "@tanstack/react-router";
import { cn } from "cn";
import { useTranslation } from "react-i18next";

import { langParam, useLocale } from "../../lib/i18n.ts";
import { buttonVariants } from "../ui/button.tsx";

import { PILL, StatusSheet } from "./status-sheet.tsx";

/** The page the router shows for any address no route draws. */
export function NotFound() {
  const { t } = useTranslation();
  const locale = useLocale();

  return (
    <StatusSheet
      glyphs={["4", "0", "4"]}
      title={t("status.not-found.title")}
      lede={t("status.not-found.lede")}>
      <Link
        to="/{-$lang}"
        params={{ lang: langParam(locale) }}
        className={cn(
          buttonVariants({ variant: "foreground", size: "lg" }),
          PILL
        )}>
        {t("status.home")}
      </Link>
      <Link
        to="/{-$lang}/docs/$"
        params={{ lang: langParam(locale), _splat: "" }}
        className={cn(
          buttonVariants({ variant: "outline", size: "lg" }),
          PILL
        )}>
        {t("hero.docs")}
      </Link>
    </StatusSheet>
  );
}
