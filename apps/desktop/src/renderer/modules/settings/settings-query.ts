import { queryOptions, useQuery } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";

import { McpServerState } from "@solyx/agent/mcp-config";
import type { AgentModelRef } from "@solyx/agent/providers";

import { isDecisionsReady } from "#shared/ipc/settings.ts";
import type { AgentSettings, MarketDataStatus } from "#shared/ipc/settings.ts";

const all = ["settings"] as const;

export const settingsQueryKeys = {
  all,
  // Outside `all`: the appearance arrives whole on a push of its own, so another setting's push
  // never reads it again over a palette being previewed.
  appearance: ["appearance"] as const,
  about: [...all, "about"] as const,
  secrets: [...all, "secrets"] as const,
  marketData: [...all, "market-data"] as const,
  agent: [...all, "agent"] as const,
  news: [...all, "news"] as const,
  fundamentals: [...all, "fundamentals"] as const,
  webSearch: [...all, "web-search"] as const,
  decisions: [...all, "decisions"] as const,
  embeddings: [...all, "embeddings"] as const,
  agentSkills: [...all, "agent-skills"] as const,
  memory: [...all, "memory"] as const,
  updates: [...all, "updates"] as const,
  crashReports: [...all, "crash-reports"] as const,
  traces: [...all, "traces"] as const,
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

const selectMarkets = (status: MarketDataStatus) => status.markets;

/**
 * Each market's source, for readers that need only whether it is ready. Only the config file and
 * the secret store change that, and both push, so unlike the Fubon session it never goes stale
 * on its own.
 */
export function useMarketSources() {
  return useQuery({
    ...marketDataQuery(),
    staleTime: Infinity,
    select: selectMarkets,
  });
}

/** Whether the model's provider is switched on with its key saved or subscription signed in, so it can run. */
export function isModelReady(settings: AgentSettings, model: AgentModelRef) {
  return (
    settings.models.some(
      (each) => each.provider === model.provider && each.id === model.id
    ) &&
    settings.providers.some(
      (each) => each.provider === model.provider && each.usable
    )
  );
}

/** Never stale, since the main process pushes every change, hand edits to the config file included. */
export const appearanceQuery = () =>
  queryOptions({
    queryKey: settingsQueryKeys.appearance,
    queryFn: () => window.solyx.settings.appearance(),
    staleTime: Infinity,
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
export const memorySettingsQuery = () =>
  queryOptions({
    queryKey: settingsQueryKeys.memory,
    queryFn: () => window.solyx.settings.memory(),
    staleTime: Infinity,
  });

/** Never stale, as below. */
export const updateSettingsQuery = () =>
  queryOptions({
    queryKey: settingsQueryKeys.updates,
    queryFn: () => window.solyx.settings.updates(),
    staleTime: Infinity,
  });

/** Never stale, as below. */
export const traceSettingsQuery = () =>
  queryOptions({
    queryKey: settingsQueryKeys.traces,
    queryFn: () => window.solyx.settings.traces(),
    staleTime: Infinity,
  });

/** Never stale, as below. */
export const crashReportSettingsQuery = () =>
  queryOptions({
    queryKey: settingsQueryKeys.crashReports,
    queryFn: () => window.solyx.settings.crashReports(),
    staleTime: Infinity,
  });

export const newsSettingsQuery = () =>
  queryOptions({
    queryKey: settingsQueryKeys.news,
    queryFn: () => window.solyx.settings.news(),
    staleTime: Infinity,
  });

/** Never stale, as below. */
export const fundamentalsSettingsQuery = () =>
  queryOptions({
    queryKey: settingsQueryKeys.fundamentals,
    queryFn: () => window.solyx.settings.fundamentals(),
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

/** Never stale, as below. */
export const embeddingsSettingsQuery = () =>
  queryOptions({
    queryKey: settingsQueryKeys.embeddings,
    queryFn: () => window.solyx.settings.embeddings(),
    staleTime: Infinity,
  });

/**
 * Whether a decisions model is set up, without which news goes unscored, research claims unread
 * and auto asks about every shell command. Until the settings load, assumes one is rather than
 * flash what shows without it.
 */
export function useDecisionsReady() {
  const { data: settings } = useQuery(decisionsSettingsQuery());
  const { data: secrets } = useQuery(secretsQuery());

  return settings === undefined || secrets === undefined
    ? true
    : isDecisionsReady(settings, secrets);
}

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
export function followSettingsChanges(queryClient: QueryClient) {
  window.solyx.settings.onChanged(() => {
    void queryClient.invalidateQueries({ queryKey: settingsQueryKeys.all });
  });
}
