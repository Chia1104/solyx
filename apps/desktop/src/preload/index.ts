import { contextBridge, ipcRenderer } from "electron";

import { accountChannels } from "#shared/ipc/account.ts";
import { marketChannels } from "#shared/ipc/market.ts";
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
  },
};

contextBridge.exposeInMainWorld("solyx", api);
