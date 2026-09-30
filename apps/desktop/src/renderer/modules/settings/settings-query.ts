import { queryOptions } from "@tanstack/react-query";

import { McpServerState } from "@solyx/agent/mcp-config";

export const settingsQueryKeys = {
  all: ["settings"] as const,
  theme: ["settings", "theme"] as const,
  cacheUsage: ["settings", "cache-usage"] as const,
  about: ["settings", "about"] as const,
  secrets: ["settings", "secrets"] as const,
  marketData: ["settings", "market-data"] as const,
  agent: ["settings", "agent"] as const,
  agentSkills: ["settings", "agent-skills"] as const,
  mcp: ["settings", "mcp"] as const,
};

/** Which secrets are saved; their values never leave the main process. */
export const secretsQuery = () =>
  queryOptions({
    queryKey: settingsQueryKeys.secrets,
    queryFn: () => window.solyx.settings.secrets(),
  });

/** Always stale, since the settings can also change by hand in the config file. */
export const marketDataQuery = () =>
  queryOptions({
    queryKey: settingsQueryKeys.marketData,
    queryFn: () => window.solyx.settings.marketData(),
    staleTime: 0,
  });

/** Always stale, since the theme can also change by hand in the config file. */
export const themeQuery = () =>
  queryOptions({
    queryKey: settingsQueryKeys.theme,
    queryFn: () => window.solyx.settings.theme(),
    staleTime: 0,
  });

export const cacheUsageQuery = () =>
  queryOptions({
    queryKey: settingsQueryKeys.cacheUsage,
    queryFn: () => window.solyx.settings.cacheUsage(),
    staleTime: 0,
  });

/** Versions and paths do not change while the app runs. */
export const aboutQuery = () =>
  queryOptions({
    queryKey: settingsQueryKeys.about,
    queryFn: () => window.solyx.settings.about(),
    staleTime: Infinity,
  });

/** Always stale, since the settings can also change by hand in the config file. */
export const agentSettingsQuery = () =>
  queryOptions({
    queryKey: settingsQueryKeys.agent,
    queryFn: () => window.solyx.settings.agent(),
    staleTime: 0,
  });

/** Always stale, since skills and instructions are files the user edits outside the app. */
export const agentSkillsQuery = () =>
  queryOptions({
    queryKey: settingsQueryKeys.agentSkills,
    queryFn: () => window.solyx.settings.agentSkills(),
    staleTime: 0,
  });

/** Polled while a server is still connecting, since connecting happens in the main process. */
export const mcpQuery = () =>
  queryOptions({
    queryKey: settingsQueryKeys.mcp,
    queryFn: () => window.solyx.settings.mcp(),
    staleTime: 0,
    refetchInterval: (query) =>
      query.state.data?.servers.some(
        (server) => server.state === McpServerState.Connecting
      )
        ? 1500
        : false,
  });
