import { contextBridge, ipcRenderer } from "electron";
import type { IpcRendererEvent } from "electron";

import { accountChannels } from "#shared/ipc/account.ts";
import { marketChannels, marketEvents } from "#shared/ipc/market.ts";
import type { LiveCandle } from "#shared/ipc/market.ts";
import { proposalsChannels } from "#shared/ipc/proposals.ts";
import { settingsChannels } from "#shared/ipc/settings.ts";
import type { SolyxApi } from "#shared/ipc/solyx-api.ts";
import { watchlistChannels } from "#shared/ipc/watchlist.ts";

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

const api: SolyxApi = {
  account: {
    summary: () => invoke(accountChannels.summary),
  },
  market: {
    sessions: () => invoke(marketChannels.sessions),
    listing: (symbol) => invoke(marketChannels.listing, symbol),
    candles: (symbol, interval) =>
      invoke(marketChannels.candles, symbol, interval),
    watchCandles: (symbol, interval) =>
      invoke(marketChannels.watchCandles, symbol, interval),
    unwatchCandles: (symbol, interval) =>
      invoke(marketChannels.unwatchCandles, symbol, interval),
    onLiveCandles: (listener) => {
      const forward = (_event: IpcRendererEvent, updates: LiveCandle[]) =>
        listener(updates);

      ipcRenderer.on(marketEvents.onLiveCandles, forward);

      return () => {
        ipcRenderer.removeListener(marketEvents.onLiveCandles, forward);
      };
    },
  },
  proposals: {
    list: () => invoke(proposalsChannels.list),
    propose: (order, rationale) =>
      invoke(proposalsChannels.propose, order, rationale),
    confirm: (id) => invoke(proposalsChannels.confirm, id),
    dismiss: (id) => invoke(proposalsChannels.dismiss, id),
  },
  settings: {
    theme: () => invoke(settingsChannels.theme),
    setTheme: (theme) => invoke(settingsChannels.setTheme, theme),
    secrets: () => invoke(settingsChannels.secrets),
    saveSecret: (secret, value) =>
      invoke(settingsChannels.saveSecret, secret, value),
    deleteSecret: (secret) => invoke(settingsChannels.deleteSecret, secret),
    marketData: () => invoke(settingsChannels.marketData),
    setMarketDataSource: (market, source) =>
      invoke(settingsChannels.setMarketDataSource, market, source),
    setFuglePlan: (plan) => invoke(settingsChannels.setFuglePlan, plan),
    chooseFubonFile: (file) => invoke(settingsChannels.chooseFubonFile, file),
    signInFubon: () => invoke(settingsChannels.signInFubon),
    cacheUsage: () => invoke(settingsChannels.cacheUsage),
    clearCache: () => invoke(settingsChannels.clearCache),
    about: () => invoke(settingsChannels.about),
    reveal: (location) => invoke(settingsChannels.reveal, location),
  },
  watchlist: {
    list: () => invoke(watchlistChannels.list),
    add: (symbol) => invoke(watchlistChannels.add, symbol),
    remove: (symbol) => invoke(watchlistChannels.remove, symbol),
  },
};

contextBridge.exposeInMainWorld("solyx", api);
