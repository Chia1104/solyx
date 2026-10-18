import { hashKey, useQuery } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";

import { McpServerState } from "@solyx/agent/mcp-config";
import type { AgentModelRef, AgentProvider } from "@solyx/agent/providers";

import { isDecisionsReady } from "#shared/settings.ts";
import type { AgentSettings, MarketDataStatus } from "#shared/settings.ts";

import { client, forEachEvent, orpc } from "../../app/rpc.ts";

/** Which secrets are saved; their values never leave the main process. Never stale, as below. */
export const secretsQuery = () =>
  orpc.settings.secrets.queryOptions({
    staleTime: Infinity,
  });

/** Always stale, since a Fubon sign-in can change it without any setting changing. */
export const marketDataQuery = () =>
  orpc.settings.marketData.queryOptions({
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
  orpc.settings.appearance.queryOptions({
    staleTime: Infinity,
  });

/** Versions and paths do not change while the app runs. */
export const aboutQuery = () =>
  orpc.settings.about.queryOptions({
    staleTime: Infinity,
  });

/** Never stale, as below. */
export const agentSettingsQuery = () =>
  orpc.settings.agent.queryOptions({
    staleTime: Infinity,
  });

/**
 * Asked again as its row opens, as the window regains focus once stale and on any settings change,
 * since a model pulled in a terminal tells the app nothing.
 */
export const agentServerModelsQuery = (provider: AgentProvider) =>
  orpc.settings.agentServerModels.queryOptions({ input: provider });

/** Never stale, as below. */
export const memorySettingsQuery = () =>
  orpc.settings.memory.queryOptions({
    staleTime: Infinity,
  });

/** Never stale, as below. */
export const traySettingsQuery = () =>
  orpc.settings.tray.queryOptions({
    staleTime: Infinity,
  });

/** How long each voice's news is kept. Never stale, as below. */
export const newsRetentionQuery = () =>
  orpc.settings.newsRetention.queryOptions({
    staleTime: Infinity,
  });

/** Never stale, as below. */
export const tradingSettingsQuery = () =>
  orpc.settings.trading.queryOptions({
    staleTime: Infinity,
  });

/** Never stale, as below. */
export const updateSettingsQuery = () =>
  orpc.settings.updates.queryOptions({
    staleTime: Infinity,
  });

/** Never stale, as below. */
export const otlpSettingsQuery = () =>
  orpc.settings.otlp.queryOptions({
    staleTime: Infinity,
  });

/** Never stale, as below. */
export const crashReportSettingsQuery = () =>
  orpc.settings.crashReports.queryOptions({
    staleTime: Infinity,
  });

/** Never stale, as below. */
export const fundamentalsSettingsQuery = () =>
  orpc.settings.fundamentals.queryOptions({
    staleTime: Infinity,
  });

/** Never stale, as below. */
export const webSearchSettingsQuery = () =>
  orpc.settings.webSearch.queryOptions({
    staleTime: Infinity,
  });

/** Never stale, as below. */
export const decisionsSettingsQuery = () =>
  orpc.settings.decisions.queryOptions({
    staleTime: Infinity,
  });

/** Never stale, as below. */
export const embeddingsSettingsQuery = () =>
  orpc.settings.embeddings.queryOptions({
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
  orpc.settings.agentSkills.queryOptions({
    staleTime: 0,
  });

/** Polled while a server is still connecting, since connecting happens in the main process. */
export const mcpQuery = () =>
  orpc.settings.mcp.queryOptions({
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
 * or by hand in the config file. Queries that read only those never go stale on their own. The
 * appearance arrives whole on a stream of its own, so another setting's change never reads it
 * again over a palette being previewed.
 */
export function followSettingsChanges(queryClient: QueryClient) {
  const appearance = hashKey(orpc.settings.appearance.queryKey());

  void forEachEvent(client.settings.changes(), () => {
    void queryClient.invalidateQueries({
      queryKey: orpc.settings.key(),
      predicate: (query) => query.queryHash !== appearance,
    });
  });
}
