import { contextBridge, ipcRenderer } from "electron";

import { accountChannels } from "#shared/ipc/account.ts";
import { marketChannels } from "#shared/ipc/market.ts";
import { proposalsChannels } from "#shared/ipc/proposals.ts";
import type { SolyxApi } from "#shared/ipc/solyx-api.ts";

const api: SolyxApi = {
  account: {
    summary: () => ipcRenderer.invoke(accountChannels.summary),
  },
  market: {
    sessions: () => ipcRenderer.invoke(marketChannels.sessions),
  },
  proposals: {
    list: () => ipcRenderer.invoke(proposalsChannels.list),
    propose: (order, rationale) =>
      ipcRenderer.invoke(proposalsChannels.propose, order, rationale),
    confirm: (id) => ipcRenderer.invoke(proposalsChannels.confirm, id),
    dismiss: (id) => ipcRenderer.invoke(proposalsChannels.dismiss, id),
  },
};

contextBridge.exposeInMainWorld("solyx", api);
