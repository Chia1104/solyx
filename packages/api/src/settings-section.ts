import * as z from "zod";

/** The settings page's sections, kept in the URL so links can open one. */
export const SettingsSection = {
  General: "general",
  MarketData: "market-data",
  Brokers: "brokers",
  Orders: "orders",
  Models: "models",
  Skills: "skills",
  Mcp: "mcp",
  Memory: "memory",
  Schedules: "schedules",
  WebSearch: "web-search",
  Decisions: "decisions",
  Embeddings: "embeddings",
  Themes: "themes",
  CodeExecution: "code-execution",
  Devices: "devices",
  Storage: "storage",
  Backup: "backup",
  Observability: "observability",
  About: "about",
} as const;

export type SettingsSection =
  (typeof SettingsSection)[keyof typeof SettingsSection];

export const settingsSectionSchema = z.enum(SettingsSection);

/** The section's address in the router's hash, which the agent's replies link to. */
export const settingsLink = (section: SettingsSection) =>
  `#/settings?section=${section}`;
