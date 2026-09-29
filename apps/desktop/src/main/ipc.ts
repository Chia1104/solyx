import { ipcMain } from "electron";

import { Market } from "@solyx/core/market";
import { ProposalSource } from "@solyx/core/order-desk";
import { getSession } from "@solyx/core/session";

import { IPC_CHANNELS } from "../shared/ipc.ts";
import type { SolyxApi } from "../shared/ipc.ts";

import type { Services } from "./services.ts";

function handle<K extends keyof SolyxApi>(
  name: K,
  handler: (...args: Parameters<SolyxApi[K]>) => ReturnType<SolyxApi[K]>
) {
  ipcMain.handle(IPC_CHANNELS[name], (_event, ...args) =>
    // SAFETY: only preload/index.ts invokes these channels, forwarding the arguments of the
    // matching `SolyxApi` method; the renderer is our own bundle and cannot load remote content.
    handler(...(args as Parameters<SolyxApi[K]>))
  );
}

export function registerIpc({ broker, desk }: Services) {
  handle("getOverview", async () => ({
    brokerMode: broker.mode,
    sessions: {
      [Market.TW]: getSession(Market.TW),
      [Market.US]: getSession(Market.US),
    },
    account: await broker.getAccount(),
    proposals: desk.list(),
  }));
  handle("proposeOrder", (order, rationale) =>
    desk.propose({ order, rationale, source: ProposalSource.User })
  );
  // The single road to broker.placeOrder. Never hand confirm to an agent as a tool.
  handle("confirmProposal", (id) => desk.confirm(id));
  handle("dismissProposal", async (id) => desk.dismiss(id));
}
