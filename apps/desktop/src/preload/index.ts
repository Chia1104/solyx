import { contextBridge, ipcRenderer } from "electron";
import type { IpcRendererEvent } from "electron";

import { accountChannels } from "#shared/ipc/account.ts";
import type { AccountApi } from "#shared/ipc/account.ts";
import { agentChannels, agentEvents } from "#shared/ipc/agent.ts";
import type { AgentApi, AgentEvents } from "#shared/ipc/agent.ts";
import { calendarChannels } from "#shared/ipc/calendar.ts";
import type { CalendarApi } from "#shared/ipc/calendar.ts";
import { flowsChannels } from "#shared/ipc/flows.ts";
import type { FlowsApi } from "#shared/ipc/flows.ts";
import { marketChannels, marketEvents } from "#shared/ipc/market.ts";
import type { MarketApi, MarketEvents } from "#shared/ipc/market.ts";
import { memoryChannels, memoryEvents } from "#shared/ipc/memory.ts";
import type { MemoryApi, MemoryEvents } from "#shared/ipc/memory.ts";
import { newsChannels, newsEvents } from "#shared/ipc/news.ts";
import type { NewsApi, NewsEvents } from "#shared/ipc/news.ts";
import { proposalsChannels, proposalsEvents } from "#shared/ipc/proposals.ts";
import type { ProposalsApi, ProposalsEvents } from "#shared/ipc/proposals.ts";
import { researchChannels, researchEvents } from "#shared/ipc/research.ts";
import type { ResearchApi, ResearchEvents } from "#shared/ipc/research.ts";
import { settingsChannels, settingsEvents } from "#shared/ipc/settings.ts";
import type { SettingsApi, SettingsEvents } from "#shared/ipc/settings.ts";
import type { SolyxApi } from "#shared/ipc/solyx-api.ts";
import { storageChannels } from "#shared/ipc/storage.ts";
import type { StorageApi } from "#shared/ipc/storage.ts";
import { updatesChannels, updatesEvents } from "#shared/ipc/updates.ts";
import type { UpdatesApi, UpdatesEvents } from "#shared/ipc/updates.ts";
import { watchlistChannels } from "#shared/ipc/watchlist.ts";
import type { WatchlistApi } from "#shared/ipc/watchlist.ts";

// Electron prefixes a failed handler's error with its channel; the renderer shows the main
// process's own message.
const REMOTE_ERROR_PREFIX =
  /^Error invoking remote method '[^']+': (?:\w*Error: )?/;

const invoke: typeof ipcRenderer.invoke = async (channel, ...args) => {
  try {
    return await ipcRenderer.invoke(channel, ...args);
  } catch (error) {
    throw error instanceof Error
      ? new Error(error.message.replace(REMOTE_ERROR_PREFIX, ""))
      : error;
  }
};

/** Hands each push on `channel` to `listener` until the returned function is called. */
function subscribe<Payload>(
  channel: string,
  listener: (payload: Payload) => void
): () => void {
  const forward = (_event: IpcRendererEvent, payload: Payload) =>
    listener(payload);

  ipcRenderer.on(channel, forward);

  return () => {
    ipcRenderer.removeListener(channel, forward);
  };
}

/**
 * A module's half of `window.solyx`: for each channel a function that invokes it with the caller's
 * arguments, and for each event one that subscribes to it.
 */
function bridge<Api, Events = Record<never, never>>(
  channels: Record<keyof Api, string>,
  events?: Record<keyof Events, string>
): Api & Events {
  const module = Object.fromEntries([
    ...Object.entries<string>(channels).map(([name, channel]) => [
      name,
      invoke.bind(undefined, channel),
    ]),
    ...Object.entries<string>(events ?? {}).map(([name, channel]) => [
      name,
      subscribe.bind(undefined, channel),
    ]),
  ]);

  // SAFETY: each method passes its arguments through to the handler bound to its channel, and each
  // event subscribes to its own; the channel maps `satisfies` the keys of their contracts.
  return module as Api & Events;
}

const api: SolyxApi = {
  account: bridge<AccountApi>(accountChannels),
  agent: bridge<AgentApi, AgentEvents>(agentChannels, agentEvents),
  calendar: bridge<CalendarApi>(calendarChannels),
  flows: bridge<FlowsApi>(flowsChannels),
  market: bridge<MarketApi, MarketEvents>(marketChannels, marketEvents),
  memory: bridge<MemoryApi, MemoryEvents>(memoryChannels, memoryEvents),
  news: bridge<NewsApi, NewsEvents>(newsChannels, newsEvents),
  proposals: bridge<ProposalsApi, ProposalsEvents>(
    proposalsChannels,
    proposalsEvents
  ),
  research: bridge<ResearchApi, ResearchEvents>(
    researchChannels,
    researchEvents
  ),
  settings: bridge<SettingsApi, SettingsEvents>(
    settingsChannels,
    settingsEvents
  ),
  storage: bridge<StorageApi>(storageChannels),
  updates: bridge<UpdatesApi, UpdatesEvents>(updatesChannels, updatesEvents),
  watchlist: bridge<WatchlistApi>(watchlistChannels),
};

contextBridge.exposeInMainWorld("solyx", api);
