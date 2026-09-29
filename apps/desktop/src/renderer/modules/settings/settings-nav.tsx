import { cn } from "@heroui/react";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { RailedColumn } from "../../components/sheet.tsx";

import { SettingsSection } from "./settings-section.ts";

/** Links to the settings sections; the open one is underlined in ink. */
export function SettingsNav({ current }: { current: SettingsSection }) {
  const { t } = useTranslation();

  return (
    <nav aria-label={t("settings.title")} className="border-b border-separator">
      <RailedColumn className="flex gap-1 px-3">
        {Object.values(SettingsSection).map((section) => (
          <Link
            key={section}
            to="/settings"
            search={{ section }}
            aria-current={section === current ? "page" : undefined}
            className={cn(
              "relative flex h-10 items-center rounded-sm px-3 text-sm font-medium text-muted outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-inset",
              section === current &&
                "text-foreground after:absolute after:inset-x-3 after:-bottom-px after:h-0.5 after:bg-accent"
            )}>
            {t(`settings.sections.${section}`)}
          </Link>
        ))}
      </RailedColumn>
    </nav>
  );
}
