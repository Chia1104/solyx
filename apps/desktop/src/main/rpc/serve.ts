import { RPCHandler } from "@orpc/server/message-port";
import { ipcMain } from "electron";

import { RPC_CONNECT } from "#shared/rpc/connect.ts";

import type { Services } from "../services.ts";

import { keepMessages } from "./messages.ts";
import { router } from "./router.ts";

/** Serves the router on a window's ports; built once, since each port keeps its own calls. */
export const rpcHandler = new RPCHandler(router, {
  clientInterceptors: [keepMessages],
});

/**
 * Serves every window on the port it connects with, as the window that asked. A port closes with
 * its page, which ends the streams it was sent, so a reload or a closed window leaves no listener.
 */
export function serveRpc(services: Services) {
  ipcMain.on(RPC_CONNECT, (event) => {
    const [port] = event.ports;

    rpcHandler.upgrade(port, {
      context: { ...services, sender: event.sender },
    });
    port.start();
  });
}
