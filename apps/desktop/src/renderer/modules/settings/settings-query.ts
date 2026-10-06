import { useEffect } from "react";

import { queryOptions, useQueryClient } from "@tanstack/react-query";

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
  news: [...all, "news"] as const,
  webSearch: [...all, "web-search"] as const,
  decisions: [...all, "decisions"] as const,
  agentSkills: [...all, "agent-skills"] as const,
  mcp: [...all, "mcp"] as const,
};

/** Which secrets are saved; their values never leave the main process. Never stale, as below. */
export const secretsQuery = () =>
  queryOptions({
    queryKey: settingsQueryKeys.secrets,
    queryFn: () => window.solyx.settings.secrets(),
    staleTime: Infinity,
  });

/** Always stale, since a Fubon sign-in can change it without any setting changing. */
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

/** Never stale, as below. */
export const agentSettingsQuery = () =>
  queryOptions({
    queryKey: settingsQueryKeys.agent,
    queryFn: () => window.solyx.settings.agent(),
    staleTime: Infinity,
  });

/** Never stale, as below. */
export const newsSettingsQuery = () =>
  queryOptions({
    queryKey: settingsQueryKeys.news,
    queryFn: () => window.solyx.settings.news(),
    staleTime: Infinity,
  });

/** Never stale, as below. */
export const webSearchSettingsQuery = () =>
  queryOptions({
    queryKey: settingsQueryKeys.webSearch,
    queryFn: () => window.solyx.settings.webSearch(),
    staleTime: Infinity,
  });

/** Never stale, as below. */
export const decisionsSettingsQuery = () =>
  queryOptions({
    queryKey: settingsQueryKeys.decisions,
    queryFn: () => window.solyx.settings.decisions(),
    staleTime: Infinity,
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

/**
 * Refetches the settings whenever one, or a saved secret, changes: on this page, in another window
 * or by hand in the config file. Queries that read only those never go stale on their own.
 */
export function useSettingsChanges() {
  const queryClient = useQueryClient();

  useEffect(
    () =>
      window.solyx.settings.onChanged(() => {
        void queryClient.invalidateQueries({ queryKey: settingsQueryKeys.all });
      }),
    [queryClient]
  );
}
