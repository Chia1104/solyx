import { queryOptions } from "@tanstack/react-query";

import { McpServerState } from "@solyx/agent/mcp-config";
import { Market } from "@solyx/core/market";

import type { MarketDataStatus } from "#shared/ipc/settings.ts";

const all = ["settings"] as const;

export const settingsQueryKeys = {
  all,
  appearance: [...all, "appearance"] as const,
  cacheUsage: [...all, "cache-usage"] as const,
  about: [...all, "about"] as const,
  secrets: [...all, "secrets"] as const,
  marketData: [...all, "market-data"] as const,
  agent: [...all, "agent"] as const,
  agentSkills: [...all, "agent-skills"] as const,
  mcp: [...all, "mcp"] as const,
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

/** Whether Taiwan market data has everything its source connects with saved. */
export function isMarketDataReady(status: MarketDataStatus | undefined) {
  return status?.markets[Market.TW]?.ready === true;
}

/** Never stale, since the main process pushes every change, hand edits to the config file included. */
export const appearanceQuery = () =>
  queryOptions({
    queryKey: settingsQueryKeys.appearance,
    queryFn: () => window.solyx.settings.appearance(),
    staleTime: Infinity,
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
