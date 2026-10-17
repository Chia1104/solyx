import { createFileRoute, notFound } from "@tanstack/react-router";
import { HomeLayout } from "fumadocs-ui/layouts/home";
import { useTranslation } from "react-i18next";
import releases from "virtual:release-notes";

import { ReleaseNotes } from "../../components/changelog/release-notes.tsx";
import { Sheet, SheetRow } from "../../components/landing/sheet.tsx";
import { SiteFooter } from "../../components/landing/site-footer.tsx";
import {
  Locale,
  localeOf,
  localePath,
  translators,
  useLocale,
} from "../../lib/i18n.ts";
import { baseOptions } from "../../lib/layout.tsx";
import { socialCardMeta } from "../../lib/social-card.ts";

export const Route = createFileRoute("/{-$lang}/changelog")({
  beforeLoad: ({ params }) => {
    if (!localeOf(params.lang)) throw notFound();
  },
  head: ({ params }) => {
    const locale = localeOf(params.lang) ?? Locale.EnUS;
    const { t } = translators[locale];

    return {
      meta: [
        { title: t("meta.page-title", { title: t("changelog.title") }) },
        { name: "description", content: t("changelog.lede") },
        { property: "og:title", content: t("changelog.title") },
        { property: "og:description", content: t("changelog.lede") },
        socialCardMeta(localePath(locale, "/changelog")),
      ],
    };
  },
  component: Changelog,
});

function Changelog() {
  const { t } = useTranslation();

  return (
    <HomeLayout {...baseOptions(useLocale())}>
      <main className="flex-1">
        <Sheet>
          <SheetRow
            ruled={false}
            className="px-6 pt-20 pb-12 text-center md:pt-24">
            <h1 className="text-[clamp(2.4rem,5.6vw,4rem)] leading-[1.02] font-[540] tracking-[-0.028em] text-balance [font-stretch:112%]">
              {t("changelog.title")}
            </h1>
            <p className="text-muted-foreground mx-auto mt-5 max-w-[34em] text-lg leading-relaxed text-pretty">
              {t("changelog.lede")}
            </p>
          </SheetRow>
          {releases.map((release) => (
            <ReleaseNotes key={release.version} release={release} />
          ))}
        </Sheet>
      </main>
      <SiteFooter />
    </HomeLayout>
  );
}
