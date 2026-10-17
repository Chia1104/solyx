import { Link, useRouter } from "@tanstack/react-router";
import { cn } from "cn";
import { useTranslation } from "react-i18next";

import { langParam, useLocale } from "../../lib/i18n.ts";
import { Button, buttonVariants } from "../ui/button.tsx";

import { PILL, StatusSheet } from "./status-sheet.tsx";

/**
 * The page the router shows when a route fails to load or draw. The site sends nothing about its
 * visitors, so the error goes no further than this page.
 */
export function ErrorPage() {
  const { t } = useTranslation();
  const locale = useLocale();
  const router = useRouter();

  return (
    <StatusSheet
      glyphs={["E", "R", "R", "O", "R"]}
      title={t("status.error.title")}
      lede={t("status.error.lede")}>
      {/* Reloading the route also clears its error boundary. */}
      <Button
        variant="foreground"
        size="lg"
        className={PILL}
        onClick={() => void router.invalidate()}>
        {t("status.error.retry")}
      </Button>
      <Link
        to="/{-$lang}"
        params={{ lang: langParam(locale) }}
        className={cn(
          buttonVariants({ variant: "outline", size: "lg" }),
          PILL
        )}>
        {t("status.home")}
      </Link>
    </StatusSheet>
  );
}
