import * as z from "zod";

/** The settings page's tabs, kept in the URL so links can open one. */
export const SettingsSection = {
  General: "general",
  MarketData: "market-data",
  Agent: "agent",
  Skills: "skills",
  Schedules: "schedules",
  Memory: "memory",
  Mcp: "mcp",
  Storage: "storage",
  About: "about",
} as const;

export type SettingsSection =
  (typeof SettingsSection)[keyof typeof SettingsSection];

export const settingsSectionSchema = z.enum(SettingsSection);

/** The tab's address in the router's hash, which the agent's replies link to. */
export const settingsLink = (section: SettingsSection) =>
  `#/settings?section=${section}`;
