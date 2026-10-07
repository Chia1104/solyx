import { useEffect } from "react";

import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";

import { McpServerState } from "@solyx/agent/mcp-config";
import type { AgentModelRef } from "@solyx/agent/providers";
import { Market } from "@solyx/core/market";

import { DECISIONS_SECRETS, SecretState } from "#shared/ipc/settings.ts";
import type {
  AgentSettings,
  DecisionsSettings,
  MarketDataStatus,
  SecretsStatus,
  WebSearchSettings,
} from "#shared/ipc/settings.ts";

const all = ["settings"] as const;

export const settingsQueryKeys = {
  all,
  appearance: [...all, "appearance"] as const,
  about: [...all, "about"] as const,
  secrets: [...all, "secrets"] as const,
  marketData: [...all, "market-data"] as const,
  agent: [...all, "agent"] as const,
  news: [...all, "news"] as const,
  webSearch: [...all, "web-search"] as const,
  decisions: [...all, "decisions"] as const,
  agentSkills: [...all, "agent-skills"] as const,
  memory: [...all, "memory"] as const,
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

/** Whether the vendor in use has its key saved, so news and the agent can search the web. */
export function isWebSearchReady(settings: WebSearchSettings | undefined) {
  return (
    settings !== undefined &&
    settings.keys[settings.provider] === SecretState.Saved
  );
}

/** Whether the provider in use has its key saved, and Cloudflare its account, so its model can score. */
export function isDecisionsReady(
  settings: DecisionsSettings | undefined,
  secrets: SecretsStatus | undefined
) {
  const current = settings?.providers.find(
    (each) => each.provider === settings.provider
  );

  return (
    current !== undefined &&
    current.accountId !== null &&
    secrets?.states[DECISIONS_SECRETS[current.provider]] === SecretState.Saved
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
