import type { ReactNode } from "react";

import { getRouteApi } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { Section } from "../components/section.tsx";
import { Sheet } from "../components/sheet.tsx";
import { MemorySettings } from "../modules/memory/memory-settings.tsx";
import { SetupGuideLink } from "../modules/onboarding/setup-guide-link.tsx";
import { AboutSettings } from "../modules/settings/about-settings.tsx";
import { AgentSettings } from "../modules/settings/agent-settings.tsx";
import { AgentSkills } from "../modules/settings/agent-skills.tsx";
import { DecisionsSettings } from "../modules/settings/decisions-settings.tsx";
import { LanguageSelect } from "../modules/settings/language-select.tsx";
import { MarketDataSettings } from "../modules/settings/market-data-settings.tsx";
import { McpSettings } from "../modules/settings/mcp-settings.tsx";
import { NewsSettings } from "../modules/settings/news-settings.tsx";
import { PalettePicker } from "../modules/settings/palette-picker.tsx";
import { PriceColorsSelect } from "../modules/settings/price-colors-select.tsx";
import { SettingsSection } from "../modules/settings/settings-section.ts";
import { SettingsTabs } from "../modules/settings/settings-tabs.tsx";
import { ThemeSelect } from "../modules/settings/theme-select.tsx";
import { TimeZoneSelect } from "../modules/settings/time-zone-select.tsx";
import { WebSearchSettings } from "../modules/settings/web-search-settings.tsx";
import { StorageSettings } from "../modules/storage/storage-settings.tsx";

const route = getRouteApi("/settings");

export function SettingsPage() {
  const { t } = useTranslation();
  const { section, server } = route.useSearch();
  const navigate = route.useNavigate();

  const content: Record<SettingsSection, ReactNode> = {
    [SettingsSection.General]: (
      <Section title={t("settings.sections.general")}>
        <div className="flex flex-col gap-6">
          <ThemeSelect />
          <PalettePicker />
          <PriceColorsSelect />
          <LanguageSelect />
          <TimeZoneSelect />
          <SetupGuideLink />
        </div>
      </Section>
    ),
    [SettingsSection.MarketData]: <MarketDataSettings />,
    [SettingsSection.Agent]: (
      <>
        <AgentSettings />
        <WebSearchSettings />
        <NewsSettings />
        <DecisionsSettings />
      </>
    ),
    [SettingsSection.Skills]: <AgentSkills />,
    [SettingsSection.Memory]: <MemorySettings />,
    [SettingsSection.Mcp]: <McpSettings server={server} />,
    [SettingsSection.Storage]: <StorageSettings />,
    [SettingsSection.About]: <AboutSettings />,
  };

  return (
    <Sheet title={t("settings.title")}>
      <SettingsTabs
        current={section}
        onChange={(next) =>
          void navigate({ search: { section: next }, replace: true })
        }
        panels={content}
      />
    </Sheet>
  );
}
