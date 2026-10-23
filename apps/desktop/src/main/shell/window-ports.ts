import { ipcMain } from "electron";

import { RPC_CONNECT } from "#shared/rpc/connect.ts";

import { serveClient } from "../rpc/serve.ts";
import type { Services } from "../services.ts";

/** Serves the router on the port each window connects with, as that window. */
export function serveWindows(services: Services) {
  ipcMain.on(RPC_CONNECT, (event) => {
    const [port] = event.ports;

    serveClient(port, { ...services, client: { window: event.sender.id } });
  });
}
