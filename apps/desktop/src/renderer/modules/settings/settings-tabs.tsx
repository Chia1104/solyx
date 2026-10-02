import type { ReactNode } from "react";

import { Tabs, cn } from "@heroui/react";
import { useTranslation } from "react-i18next";

import { isEnumValue } from "@solyx/utils/is";

import { RAILED_COLUMN } from "../../components/sheet.tsx";

import { SettingsSection } from "./settings-section.ts";

/**
 * The settings sections as tabs, drawn like the agent pane's. The URL holds the open section, so
 * the tabs follow `current` and report a choice through `onChange` rather than keep their own.
 */
export function SettingsTabs({
  current,
  onChange,
  panels,
}: {
  current: SettingsSection;
  onChange: (section: SettingsSection) => void;
  panels: Record<SettingsSection, ReactNode>;
}) {
  const { t } = useTranslation();

  return (
    <Tabs
      variant="secondary"
      selectedKey={current}
      onSelectionChange={(key) => {
        if (isEnumValue(SettingsSection, key)) onChange(key);
      }}
      className="gap-0">
      {/* HeroUI styles the list through its container as a direct child, so the rails go on the list. */}
      <Tabs.ListContainer className="border-separator">
        <Tabs.List
          aria-label={t("settings.title")}
          className={cn(RAILED_COLUMN, "flex min-w-0 gap-1 px-3")}>
          {Object.values(SettingsSection).map((section) => (
            <Tabs.Tab key={section} id={section} className="h-10 w-auto px-3">
              {t(`settings.sections.${section}`)}
              <Tabs.Indicator />
            </Tabs.Tab>
          ))}
        </Tabs.List>
      </Tabs.ListContainer>
      {Object.values(SettingsSection).map((section) => (
        <Tabs.Panel key={section} id={section} className="mt-0 p-0">
          {panels[section]}
        </Tabs.Panel>
      ))}
    </Tabs>
  );
}
