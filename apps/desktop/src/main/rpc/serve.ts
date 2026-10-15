import { ValidationError } from "@orpc/contract";
import { ORPCError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/message-port";
import { ipcMain } from "electron";
import * as z from "zod";

import { errorMessage } from "@solyx/utils/error";

import { RPC_CONNECT } from "#shared/rpc/connect.ts";

import type { Services } from "../services.ts";

import { router } from "./router.ts";

/** Serves the router on a window's ports; built once, since each port keeps its own calls. */
export const rpcHandler = new RPCHandler(router, {
  clientInterceptors: [
    // The renderer shows the main process's own message, which oRPC would replace with "Internal
    // server error", and input that does not parse in words, since the issues' JSON is unreadable.
    async ({ next, path }) => {
      try {
        return await next();
      } catch (error) {
        if (!(error instanceof ORPCError)) {
          throw new ORPCError("INTERNAL_SERVER_ERROR", {
            message: errorMessage(error),
            cause: error,
          });
        }

        if (error.cause instanceof ValidationError) {
          throw new ORPCError("BAD_REQUEST", {
            message: `Invalid input for ${path.join(".")}: ${z.prettifyError(error.cause)}`,
            cause: error.cause,
          });
        }

        throw error;
      }
    },
  ],
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
