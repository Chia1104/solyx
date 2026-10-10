import {
  BotIcon,
  Brain01Icon,
  ChartCandlestickIcon,
  Clock01Icon,
  Database01Icon,
  Globe02Icon,
  InformationCircleIcon,
  MagicWand01Icon,
  McpServerIcon,
  SlidersHorizontalIcon,
} from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@hugeicons/react";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { SettingsSection } from "#shared/settings-section.ts";

import { Icon } from "../../components/icon.tsx";

const SECTION_ICON: Record<SettingsSection, IconSvgElement> = {
  [SettingsSection.General]: SlidersHorizontalIcon,
  [SettingsSection.MarketData]: ChartCandlestickIcon,
  [SettingsSection.Agent]: BotIcon,
  [SettingsSection.Skills]: MagicWand01Icon,
  [SettingsSection.Schedules]: Clock01Icon,
  [SettingsSection.Themes]: Globe02Icon,
  [SettingsSection.Memory]: Brain01Icon,
  [SettingsSection.Mcp]: McpServerIcon,
  [SettingsSection.Storage]: Database01Icon,
  [SettingsSection.About]: InformationCircleIcon,
};

/**
 * The settings page's sections as links, the open one marked with an ink rule like an open
 * listing. A section is a choice within the page, so opening one replaces the history entry.
 */
export function SettingsNav() {
  const { t } = useTranslation();

  return (
    <nav aria-label={t("settings.title")} className="flex flex-col py-2">
      {Object.values(SettingsSection).map((section) => (
        <Link
          key={section}
          to="/settings"
          search={{ section }}
          replace
          className="group flex items-center gap-3 px-4 py-2 text-sm outline-none hover:bg-default/60 focus-visible:bg-default data-[status=active]:bg-default data-[status=active]:font-medium data-[status=active]:shadow-[inset_2px_0_0_var(--accent)]">
          <Icon
            icon={SECTION_ICON[section]}
            className="shrink-0 text-muted group-data-[status=active]:text-foreground"
          />
          <span className="truncate">{t(`settings.sections.${section}`)}</span>
        </Link>
      ))}
    </nav>
  );
}
