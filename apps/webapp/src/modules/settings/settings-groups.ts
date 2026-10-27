import { findKey } from "es-toolkit";
import * as z from "zod";
import { create } from "zustand";
import { persist } from "zustand/middleware";

import { SettingsSection } from "@solyx/api/settings-section";

import { persistOptions } from "../../app/persist.ts";

/** The settings sidebar's groups, which fold away, in the order it lists them. */
export const SettingsGroup = {
  Trading: "trading",
  Agent: "agent",
  Research: "research",
  Security: "security",
  Data: "data",
} as const;

export type SettingsGroup = (typeof SettingsGroup)[keyof typeof SettingsGroup];

/** The sections listed above the groups. */
export const TOP_SECTIONS = [SettingsSection.General];

/** The sections listed below the groups: what the app tells of itself. */
export const FOOT_SECTIONS = [
  SettingsSection.Observability,
  SettingsSection.About,
];

/** Each group's sections, listed between `TOP_SECTIONS` and `FOOT_SECTIONS`. */
export const GROUP_SECTIONS: Record<SettingsGroup, SettingsSection[]> = {
  [SettingsGroup.Trading]: [
    SettingsSection.MarketData,
    SettingsSection.Brokers,
    SettingsSection.Orders,
  ],
  [SettingsGroup.Agent]: [
    SettingsSection.Models,
    SettingsSection.Skills,
    SettingsSection.Mcp,
    SettingsSection.Memory,
    SettingsSection.Schedules,
  ],
  [SettingsGroup.Research]: [
    SettingsSection.WebSearch,
    SettingsSection.Decisions,
    SettingsSection.Embeddings,
    SettingsSection.Themes,
  ],
  [SettingsGroup.Security]: [
    SettingsSection.CodeExecution,
    SettingsSection.Devices,
  ],
  [SettingsGroup.Data]: [SettingsSection.Storage, SettingsSection.Backup],
};

export const sectionGroup = (section: SettingsSection) =>
  findKey(GROUP_SECTIONS, (sections) => sections.includes(section));

interface SettingsGroupsState {
  /** Folded by the user; every other group is open. */
  closed: SettingsGroup[];
}

interface SettingsGroupsActions {
  setClosed: (closed: SettingsGroup[]) => void;
  open: (group: SettingsGroup) => void;
}

type SettingsGroupsStore = SettingsGroupsState & SettingsGroupsActions;

const persistedSettingsGroupsSchema = z.object({
  closed: z.array(z.enum(SettingsGroup)).catch([]),
});

export const useSettingsGroupsStore = create<SettingsGroupsStore>()(
  persist(
    (set) => ({
      closed: [],
      setClosed: (closed) => set({ closed }),
      open: (group) =>
        set((state) =>
          state.closed.includes(group)
            ? { closed: state.closed.filter((each) => each !== group) }
            : state
        ),
    }),
    persistOptions<SettingsGroupsStore>(
      "settings-groups",
      persistedSettingsGroupsSchema
    )
  )
);
