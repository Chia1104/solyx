import { contextBridge, ipcRenderer } from "electron";

import { IPC_CHANNELS } from "../shared/ipc.ts";
import type { SolyxApi } from "../shared/ipc.ts";

const api: SolyxApi = {
  getOverview: () => ipcRenderer.invoke(IPC_CHANNELS.getOverview),
  proposeOrder: (order, rationale) =>
    ipcRenderer.invoke(IPC_CHANNELS.proposeOrder, order, rationale),
  confirmProposal: (id) => ipcRenderer.invoke(IPC_CHANNELS.confirmProposal, id),
  dismissProposal: (id) => ipcRenderer.invoke(IPC_CHANNELS.dismissProposal, id),
};

contextBridge.exposeInMainWorld("solyx", api);
