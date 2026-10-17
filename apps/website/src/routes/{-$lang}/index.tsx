import { createFileRoute, notFound } from "@tanstack/react-router";
import { HomeLayout } from "fumadocs-ui/layouts/home";
import { useTranslation } from "react-i18next";

import { Hero } from "../../components/hero/hero.tsx";
import { Closing } from "../../components/landing/closing.tsx";
import { Legend } from "../../components/landing/legend.tsx";
import { OrderRoad } from "../../components/landing/order-road.tsx";
import { Sheet, SheetHead, SheetRow } from "../../components/landing/sheet.tsx";
import { SiteFooter } from "../../components/landing/site-footer.tsx";
import { Sources } from "../../components/landing/sources.tsx";
import { PencilBanner } from "../../components/pencil-banner.tsx";
import { WorkspaceDemo } from "../../components/workspace/workspace-demo.tsx";
import { Locale, localeOf, translators, useLocale } from "../../lib/i18n.ts";
import { baseOptions } from "../../lib/layout.tsx";
import { socialCardMeta } from "../../lib/social-card.ts";

export const Route = createFileRoute("/{-$lang}/")({
  beforeLoad: ({ params }) => {
    if (!localeOf(params.lang)) throw notFound();
  },
  head: ({ params }) => {
    const { t } = translators[localeOf(params.lang) ?? Locale.EnUS];

    return {
      meta: [
        { title: t("meta.title") },
        { name: "description", content: t("meta.description") },
        { property: "og:title", content: t("meta.title") },
        { property: "og:description", content: t("meta.description") },
        socialCardMeta(params.lang ? `/${params.lang}` : "/"),
      ],
    };
  },
  component: Home,
});

function Home() {
  const { t } = useTranslation();

  return (
    <>
      <PencilBanner id="in-development">{t("banner.app")}</PencilBanner>
      <HomeLayout {...baseOptions(useLocale())}>
        {/* The sun's radius, which the hero draws with and the demo's heading overlaps. */}
        <main className="flex-1 [--sun:clamp(5.5rem,21vw,18rem)]">
          <Hero />
          <Sheet>
            <SheetRow ruled={false} className="pb-16 md:pb-20">
              <div className="scrim">
                <SheetHead id="demo" title={t("demo.title")}>
                  {t("demo.lede")}
                </SheetHead>
              </div>
              <div className="px-3 sm:px-6 lg:px-10">
                <WorkspaceDemo />
              </div>
            </SheetRow>
            <Legend />
            <OrderRoad />
            <Sources />
            <Closing />
          </Sheet>
        </main>
        <SiteFooter />
      </HomeLayout>
    </>
  );
}
