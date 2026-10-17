import { useState } from "react";

import { Link, createFileRoute, notFound } from "@tanstack/react-router";
import { HomeLayout } from "fumadocs-ui/layouts/home";
import { useTranslation } from "react-i18next";
import latest from "virtual:latest-releases";

import {
  ChannelInstallers,
  ComingSoon,
  QuickDownload,
} from "../../components/download/installers.tsx";
import { Sheet, SheetRow } from "../../components/landing/sheet.tsx";
import { SiteFooter } from "../../components/landing/site-footer.tsx";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "../../components/ui/tabs.tsx";
import {
  Locale,
  langParam,
  localeOf,
  localePath,
  translators,
  useLocale,
} from "../../lib/i18n.ts";
import { baseOptions } from "../../lib/layout.tsx";
import { RELEASES_URL } from "../../lib/links.ts";
import { Channel } from "../../lib/releases.ts";
import { socialCardMeta } from "../../lib/social-card.ts";

export const Route = createFileRoute("/{-$lang}/download")({
  beforeLoad: ({ params }) => {
    if (!localeOf(params.lang)) throw notFound();
  },
  head: ({ params }) => {
    const locale = localeOf(params.lang) ?? Locale.EnUS;
    const { t } = translators[locale];

    return {
      meta: [
        { title: t("meta.page-title", { title: t("nav.download") }) },
        { name: "description", content: t("download.lede") },
        { property: "og:title", content: t("download.title") },
        { property: "og:description", content: t("download.lede") },
        socialCardMeta(localePath(locale, "/download")),
      ],
    };
  },
  component: Download,
});

const CHANNELS = [Channel.Stable, Channel.Nightly];

// Stable leads once it has a release; until then the nightly does.
const lead = latest[Channel.Stable] ?? latest[Channel.Nightly];

function Download() {
  const { t } = useTranslation();
  const locale = useLocale();
  const [channel, setChannel] = useState(lead?.channel ?? Channel.Nightly);

  return (
    <HomeLayout {...baseOptions(locale)}>
      <main className="flex-1">
        <Sheet>
          <SheetRow
            ruled={false}
            className="px-6 pt-20 pb-12 text-center md:pt-24">
            <h1 className="text-[clamp(2.4rem,5.6vw,4rem)] leading-[1.02] font-[540] tracking-[-0.028em] text-balance [font-stretch:112%]">
              {t("download.title")}
            </h1>
            <p className="text-muted-foreground mx-auto mt-5 max-w-[34em] text-lg leading-relaxed text-pretty">
              {t("download.lede")}
            </p>
            {lead && <QuickDownload release={lead} />}
          </SheetRow>
          <SheetRow className="px-6 py-14 md:px-10">
            <Tabs
              value={channel}
              onValueChange={setChannel}
              className="mx-auto max-w-3xl gap-8">
              <TabsList className="mx-auto">
                {CHANNELS.map((option) => (
                  <TabsTrigger key={option} value={option} className="px-4">
                    {t(`download.channel.${option}.tab`)}
                  </TabsTrigger>
                ))}
              </TabsList>
              {CHANNELS.map((option) => {
                const release = latest[option];

                return (
                  <TabsContent
                    key={option}
                    value={option}
                    className="text-base">
                    {release ? (
                      <ChannelInstallers release={release} />
                    ) : (
                      <ComingSoon
                        onShowNightly={() => setChannel(Channel.Nightly)}
                      />
                    )}
                  </TabsContent>
                );
              })}
            </Tabs>
          </SheetRow>
          <SheetRow className="px-6 py-12 text-center">
            <p className="text-muted-foreground mx-auto max-w-[36em] text-pretty">
              {t("download.first-launch")}
            </p>
            <div className="mt-4 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm font-medium">
              <Link
                to="/{-$lang}/docs/$"
                params={{ lang: langParam(locale), _splat: "install" }}
                className="text-primary hover:underline">
                {t("download.install-guide")}
              </Link>
              <a href={RELEASES_URL} className="text-primary hover:underline">
                {t("download.all-releases")}
              </a>
            </div>
          </SheetRow>
        </Sheet>
      </main>
      <SiteFooter />
    </HomeLayout>
  );
}
