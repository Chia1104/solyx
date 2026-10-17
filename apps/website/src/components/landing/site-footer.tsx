import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { langParam, useLocale } from "../../lib/i18n.ts";
import { GITHUB_URL, RELEASES_URL } from "../../lib/links.ts";
import { Logo } from "../logo.tsx";

export function SiteFooter() {
  const { t } = useTranslation();
  const locale = useLocale();

  return (
    <footer className="border-graphite/45 border-t border-dashed">
      <div className="mx-auto grid max-w-6xl gap-8 px-6 py-12 md:grid-cols-[1fr_auto]">
        <div className="max-w-xl">
          <p className="flex items-center gap-2 font-semibold">
            <Logo className="size-6" />
            Solyx
          </p>
          <p className="text-muted-foreground mt-4 text-sm leading-relaxed">
            {t("footer.disclaimer")}
          </p>
          <p className="text-muted-foreground mt-2 text-sm">
            {t("footer.copyright")}
          </p>
        </div>
        <nav
          aria-label={t("nav.footer")}
          className="flex gap-6 text-sm md:flex-col md:gap-2">
          <Link
            to="/{-$lang}/docs/$"
            params={{ lang: langParam(locale), _splat: "" }}
            className="hover:text-primary">
            {t("nav.docs")}
          </Link>
          <a href={RELEASES_URL} className="hover:text-primary">
            {t("nav.releases")}
          </a>
          <a href={GITHUB_URL} className="hover:text-primary">
            {t("nav.github")}
          </a>
        </nav>
      </div>
    </footer>
  );
}
