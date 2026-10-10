import type { ReactNode } from "react";

import { getRouteApi } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { SettingsSection } from "#shared/settings-section.ts";

import { Section } from "../components/section.tsx";
import { Sheet } from "../components/sheet.tsx";
import { MemorySettings } from "../modules/memory/memory-settings.tsx";
import { SetupGuideLink } from "../modules/onboarding/setup-guide-link.tsx";
import { ScheduleSettings } from "../modules/schedules/schedule-settings.tsx";
import { AboutSettings } from "../modules/settings/about-settings.tsx";
import { AgentSettings } from "../modules/settings/agent-settings.tsx";
import { AgentSkills } from "../modules/settings/agent-skills.tsx";
import { DecisionsSettings } from "../modules/settings/decisions-settings.tsx";
import { EmbeddingsSettings } from "../modules/settings/embeddings-settings.tsx";
import { LanguageSelect } from "../modules/settings/language-select.tsx";
import { MarketDataSettings } from "../modules/settings/market-data-settings.tsx";
import { McpSettings } from "../modules/settings/mcp-settings.tsx";
import { PalettePicker } from "../modules/settings/palette-picker.tsx";
import { PriceColorsSelect } from "../modules/settings/price-colors-select.tsx";
import { ThemeSelect } from "../modules/settings/theme-select.tsx";
import { TimeZoneSelect } from "../modules/settings/time-zone-select.tsx";
import { WebSearchSettings } from "../modules/settings/web-search-settings.tsx";
import { StorageSettings } from "../modules/storage/storage-settings.tsx";
import { TelemetrySettings } from "../modules/telemetry/telemetry-settings.tsx";
import { ThemeSettings } from "../modules/themes/theme-settings.tsx";

const route = getRouteApi("/settings");

export function SettingsPage() {
  const { t } = useTranslation();
  const { section, server } = route.useSearch();

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
        <DecisionsSettings />
        <EmbeddingsSettings />
      </>
    ),
    [SettingsSection.Skills]: <AgentSkills />,
    [SettingsSection.Schedules]: <ScheduleSettings />,
    [SettingsSection.Themes]: <ThemeSettings />,
    [SettingsSection.Memory]: <MemorySettings />,
    [SettingsSection.Mcp]: <McpSettings server={server} />,
    [SettingsSection.Storage]: <StorageSettings />,
    [SettingsSection.About]: (
      <>
        <AboutSettings />
        <TelemetrySettings />
      </>
    ),
  };

  return <Sheet title={t("settings.title")}>{content[section]}</Sheet>;
}
