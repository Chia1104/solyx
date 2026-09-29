import { contextBridge, ipcRenderer } from "electron";
import type { IpcRendererEvent } from "electron";

import { accountChannels } from "#shared/ipc/account.ts";
import { marketChannels, marketEvents } from "#shared/ipc/market.ts";
import type { LiveCandle } from "#shared/ipc/market.ts";
import { proposalsChannels } from "#shared/ipc/proposals.ts";
import { settingsChannels } from "#shared/ipc/settings.ts";
import type { SolyxApi } from "#shared/ipc/solyx-api.ts";

const api: SolyxApi = {
  account: {
    summary: () => ipcRenderer.invoke(accountChannels.summary),
  },
  market: {
    sessions: () => ipcRenderer.invoke(marketChannels.sessions),
    candles: (symbol, interval) =>
      ipcRenderer.invoke(marketChannels.candles, symbol, interval),
    watchCandles: (symbol, interval) =>
      ipcRenderer.invoke(marketChannels.watchCandles, symbol, interval),
    unwatchCandles: (symbol, interval) =>
      ipcRenderer.invoke(marketChannels.unwatchCandles, symbol, interval),
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
    list: () => ipcRenderer.invoke(proposalsChannels.list),
    propose: (order, rationale) =>
      ipcRenderer.invoke(proposalsChannels.propose, order, rationale),
    confirm: (id) => ipcRenderer.invoke(proposalsChannels.confirm, id),
    dismiss: (id) => ipcRenderer.invoke(proposalsChannels.dismiss, id),
  },
  settings: {
    secrets: () => ipcRenderer.invoke(settingsChannels.secrets),
    saveSecret: (secret, value) =>
      ipcRenderer.invoke(settingsChannels.saveSecret, secret, value),
    deleteSecret: (secret) =>
      ipcRenderer.invoke(settingsChannels.deleteSecret, secret),
    providerPlans: () => ipcRenderer.invoke(settingsChannels.providerPlans),
    setProviderPlan: (provider, plan) =>
      ipcRenderer.invoke(settingsChannels.setProviderPlan, provider, plan),
  },
};

contextBridge.exposeInMainWorld("solyx", api);
