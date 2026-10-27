import { useEffect } from "react";

import { Disclosure, DisclosureGroup, cn } from "@heroui/react";
import {
  Activity01Icon,
  BankIcon,
  BotIcon,
  Brain01Icon,
  ChartCandlestickIcon,
  CloudUploadIcon,
  Clock01Icon,
  CommandLineIcon,
  Database01Icon,
  GitMergeIcon,
  Globe02Icon,
  InformationCircleIcon,
  Invoice01Icon,
  JusticeScale01Icon,
  LaptopPhoneSyncIcon,
  MagicWand01Icon,
  McpServerIcon,
  Search01Icon,
  SlidersHorizontalIcon,
} from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@hugeicons/react";
import { Link, useMatch } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { SettingsSection } from "@solyx/api/settings-section";

import { Icon } from "../../components/icon.tsx";

import {
  FOOT_SECTIONS,
  GROUP_SECTIONS,
  SettingsGroup,
  TOP_SECTIONS,
  sectionGroup,
  useSettingsGroupsStore,
} from "./settings-groups.ts";

const SECTION_ICON: Record<SettingsSection, IconSvgElement> = {
  [SettingsSection.General]: SlidersHorizontalIcon,
  [SettingsSection.MarketData]: ChartCandlestickIcon,
  [SettingsSection.Brokers]: BankIcon,
  [SettingsSection.Orders]: Invoice01Icon,
  [SettingsSection.Models]: BotIcon,
  [SettingsSection.Skills]: MagicWand01Icon,
  [SettingsSection.Mcp]: McpServerIcon,
  [SettingsSection.Memory]: Brain01Icon,
  [SettingsSection.Schedules]: Clock01Icon,
  [SettingsSection.WebSearch]: Search01Icon,
  [SettingsSection.Decisions]: JusticeScale01Icon,
  [SettingsSection.Embeddings]: GitMergeIcon,
  [SettingsSection.Themes]: Globe02Icon,
  [SettingsSection.CodeExecution]: CommandLineIcon,
  [SettingsSection.Devices]: LaptopPhoneSyncIcon,
  [SettingsSection.Storage]: Database01Icon,
  [SettingsSection.Backup]: CloudUploadIcon,
  [SettingsSection.Observability]: Activity01Icon,
  [SettingsSection.About]: InformationCircleIcon,
};

const GROUPS = Object.values(SettingsGroup);

/** A section is a choice within the page, so opening one replaces the history entry. */
function SectionLink({ section }: { section: SettingsSection }) {
  const { t } = useTranslation();

  return (
    <Link
      to="/settings"
      search={{ section }}
      replace
      className="group mx-2 flex items-center gap-3 rounded-sheet px-3 py-2 text-sm outline-none hover:bg-default/60 focus-visible:bg-default data-[status=active]:sheet data-[status=active]:font-medium">
      <Icon
        icon={SECTION_ICON[section]}
        className="shrink-0 text-muted group-data-[status=active]:text-foreground"
      />
      <span className="truncate">{t(`settings.sections.${section}`)}</span>
    </Link>
  );
}

/**
 * The settings page's sections as links, the open one marked with an ink rule like an open
 * listing: General, then the groups, which the user folds away, then what the app tells of itself.
 */
export function SettingsNav() {
  const { t } = useTranslation();
  const closed = useSettingsGroupsStore((state) => state.closed);
  const setClosed = useSettingsGroupsStore((state) => state.setClosed);
  const open = useSettingsGroupsStore((state) => state.open);

  // The pane outlives the settings page, which is then not open.
  const section = useMatch({
    from: "/settings",
    shouldThrow: false,
    select: (match) => match.search.section,
  });

  // Opening a section, here or from a link elsewhere, opens its group.
  useEffect(() => {
    const group = section && sectionGroup(section);

    if (group) open(group);
  }, [section, open]);

  return (
    <nav aria-label={t("settings.title")} className="flex flex-col py-2">
      {TOP_SECTIONS.map((each) => (
        <SectionLink key={each} section={each} />
      ))}
      <DisclosureGroup
        allowsMultipleExpanded
        expandedKeys={
          new Set(GROUPS.filter((group) => !closed.includes(group)))
        }
        onExpandedChange={(keys) =>
          setClosed(GROUPS.filter((group) => !keys.has(group)))
        }>
        {GROUPS.map((group) => (
          <Disclosure key={group} id={group}>
            <Disclosure.Heading>
              <Disclosure.Trigger
                className={cn(
                  "mx-2 mt-2 flex w-[calc(100%-1rem)] items-center gap-3 rounded-sheet px-3 pt-2 pb-1 text-xs font-medium text-muted outline-none hover:text-foreground focus-visible:bg-default",
                  // A folded group's heading lies on the open section's sheet.
                  closed.includes(group) &&
                    section !== undefined &&
                    GROUP_SECTIONS[group].includes(section) &&
                    "sheet pb-2 text-foreground"
                )}>
                <span className="truncate">
                  {t(`settings.groups.${group}`)}
                </span>
                <Disclosure.Indicator />
              </Disclosure.Trigger>
            </Disclosure.Heading>
            <Disclosure.Content>
              {GROUP_SECTIONS[group].map((each) => (
                <SectionLink key={each} section={each} />
              ))}
            </Disclosure.Content>
          </Disclosure>
        ))}
      </DisclosureGroup>
      <div className="mt-4">
        {FOOT_SECTIONS.map((each) => (
          <SectionLink key={each} section={each} />
        ))}
      </div>
    </nav>
  );
}
