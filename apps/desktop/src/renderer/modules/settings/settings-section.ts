import * as z from "zod";

/** The settings page's tabs, kept in the URL so links can open one. */
export const SettingsSection = {
  General: "general",
  MarketData: "market-data",
  Agent: "agent",
  Skills: "skills",
  Mcp: "mcp",
  Storage: "storage",
  About: "about",
} as const;

export type SettingsSection =
  (typeof SettingsSection)[keyof typeof SettingsSection];

export const settingsSectionSchema = z.enum(SettingsSection);
