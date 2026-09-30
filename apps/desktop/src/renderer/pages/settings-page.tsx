import type { ReactNode } from "react";

import { getRouteApi } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { Section } from "../components/section.tsx";
import { Sheet } from "../components/sheet.tsx";
import { SetupGuideLink } from "../modules/onboarding/setup-guide-link.tsx";
import { AboutSettings } from "../modules/settings/about-settings.tsx";
import { AgentSettings } from "../modules/settings/agent-settings.tsx";
import { AgentSkills } from "../modules/settings/agent-skills.tsx";
import { CacheSettings } from "../modules/settings/cache-settings.tsx";
import { LanguageSelect } from "../modules/settings/language-select.tsx";
import { MarketDataSettings } from "../modules/settings/market-data-settings.tsx";
import { McpSettings } from "../modules/settings/mcp-settings.tsx";
import { SettingsSection } from "../modules/settings/settings-section.ts";
import { SettingsTabs } from "../modules/settings/settings-tabs.tsx";
import { ThemeSelect } from "../modules/settings/theme-select.tsx";

const route = getRouteApi("/settings");

export function SettingsPage() {
  const { t } = useTranslation();
  const { section } = route.useSearch();
  const navigate = route.useNavigate();

  const content: Record<SettingsSection, ReactNode> = {
    [SettingsSection.General]: (
      <Section title={t("settings.sections.general")}>
        <div className="flex flex-col gap-6">
          <ThemeSelect />
          <LanguageSelect />
          <SetupGuideLink />
        </div>
      </Section>
    ),
    [SettingsSection.MarketData]: <MarketDataSettings />,
    [SettingsSection.Agent]: <AgentSettings />,
    [SettingsSection.Skills]: <AgentSkills />,
    [SettingsSection.Mcp]: <McpSettings />,
    [SettingsSection.Storage]: (
      <Section
        title={t("settings.storage.title")}
        description={t("settings.storage.description")}>
        <CacheSettings />
      </Section>
    ),
    [SettingsSection.About]: <AboutSettings />,
  };

  return (
    <Sheet title={t("settings.title")}>
      <SettingsTabs
        current={section}
        onChange={(next) => void navigate({ search: { section: next } })}
        panels={content}
      />
    </Sheet>
  );
}
