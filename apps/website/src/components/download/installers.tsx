import apple from "@lobehub/icons-static-svg/icons/apple.svg?url";
import microsoft from "@lobehub/icons-static-svg/icons/microsoft.svg?url";
import { Link } from "@tanstack/react-router";
import { cn } from "cn";
import { DownloadIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

import { langParam, useLocale } from "../../lib/i18n.ts";
import { useVisitorPlatform } from "../../lib/platform.ts";
import { Platform } from "../../lib/releases.ts";
import type { Release } from "../../lib/releases.ts";
import { SheetRow } from "../landing/sheet.tsx";
import { Badge } from "../ui/badge.tsx";
import { buttonVariants } from "../ui/button.tsx";

const LOGOS = {
  [Platform.MacOS]: apple,
  [Platform.Windows]: microsoft,
};

const PILL = "h-12 rounded-full px-6 text-base";

const megabytes = (bytes: number) => Math.round(bytes / 1e6);

/** A system's logo, one shape tinted with the text colour. */
function SystemLogo({
  platform,
  className,
}: {
  platform: Platform;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn("inline-block size-5 shrink-0 bg-current", className)}
      style={{ mask: `url("${LOGOS[platform]}") center / contain no-repeat` }}
    />
  );
}

/** The installer for the visitor's own system, once the page knows which system that is. */
export function QuickDownload({ release }: { release: Release }) {
  const { t } = useTranslation();
  const platform = useVisitorPlatform();

  const installer = release.installers.find(
    (candidate) => candidate.platform === platform
  );

  // The row keeps the button's height before hydration, so nothing below moves when it appears.
  return (
    <div className="mt-8 flex min-h-[4.75rem] flex-col items-center gap-3">
      {installer ? (
        <>
          <a
            href={installer.url}
            className={cn(
              buttonVariants({ variant: "foreground", size: "lg" }),
              PILL,
              "gap-2.5"
            )}>
            <SystemLogo platform={installer.platform} />
            {t("download.for", {
              system: t(`download.system.${installer.platform}.name`),
            })}
          </a>
          <p className="text-muted-foreground text-sm">
            {t("download.detail", {
              channel: t(`download.channel.${release.channel}.name`),
              version: release.version,
              size: megabytes(installer.size),
            })}
          </p>
        </>
      ) : (
        platform === null && (
          <p className="text-muted-foreground max-w-[30em] text-pretty">
            {t("download.elsewhere")}
          </p>
        )
      )}
    </div>
  );
}

/** A channel's newest release, an installer for each system, the visitor's own marked. */
export function ChannelInstallers({ release }: { release: Release }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const platform = useVisitorPlatform();

  return (
    <SheetRow className="px-6 py-14 md:px-10">
      <div className="mx-auto max-w-3xl">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
          <h2 className="text-2xl font-[470] tracking-[-0.02em] [font-stretch:108%]">
            {t(`download.channel.${release.channel}.name`)}
          </h2>
          <p className="text-muted-foreground text-sm tabular-nums">
            {release.version} ·{" "}
            {t("download.released", { date: release.publishedAt.slice(0, 10) })}
            {release.changes.length > 0 && (
              <>
                {" · "}
                <Link
                  to="/{-$lang}/changelog"
                  params={{ lang: langParam(locale) }}
                  hash={release.version}
                  className="text-primary hover:underline">
                  {t("download.whats-new")}
                </Link>
              </>
            )}
          </p>
        </div>
        <p className="text-muted-foreground mt-2 max-w-[40em] text-pretty">
          {t(`download.channel.${release.channel}.lede`)}
        </p>
        <ul className="mt-8 grid gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-2">
          {release.installers.map((installer) => {
            const visitors = installer.platform === platform;

            return (
              <li
                key={installer.name}
                className="flex flex-col gap-6 bg-background p-6">
                <div className="flex items-center gap-3">
                  <SystemLogo
                    platform={installer.platform}
                    className="size-7"
                  />
                  <div>
                    <p className="font-semibold">
                      {t(`download.system.${installer.platform}.name`)}
                    </p>
                    <p className="text-muted-foreground text-sm">
                      {t(`download.system.${installer.platform}.requirement`)}
                    </p>
                  </div>
                  {visitors && (
                    <Badge variant="outline" className="ml-auto">
                      {t("download.your-system")}
                    </Badge>
                  )}
                </div>
                <a
                  href={installer.url}
                  className={cn(
                    buttonVariants({
                      variant: visitors ? "foreground" : "outline",
                      size: "lg",
                    }),
                    "rounded-full"
                  )}>
                  <DownloadIcon />
                  {t("download.file", {
                    type: installer.name.slice(installer.name.lastIndexOf(".")),
                    size: megabytes(installer.size),
                  })}
                </a>
              </li>
            );
          })}
        </ul>
      </div>
    </SheetRow>
  );
}
