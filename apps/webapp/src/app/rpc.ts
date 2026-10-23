import { createORPCClient } from "@orpc/client";
import { RPCLink as MessagePortLink } from "@orpc/client/message-port";
import { RPCLink as WebSocketLink } from "@orpc/client/websocket";
import type { RouterContractClient } from "@orpc/contract";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";

import { DEVICE_PROTOCOL, UNPAIRED_CLOSE_CODE } from "@solyx/api/devices";
import { RPC_CONNECT } from "@solyx/api/rpc/connect";
import type { routerContract } from "@solyx/api/rpc/router.contract";

import { deviceToken, forgetDevice, inWindow } from "./device.ts";

// Long enough for the backend to come back from a restart, short enough to feel live.
const RECONNECT_MS = 3000;

/** A window's channel: the preload forwards this end's twin to the backend for as long as the page stays open. */
function windowLink() {
  const { port1: clientPort, port2: serverPort } = new MessageChannel();

  window.postMessage(RPC_CONNECT, "*", [serverPort]);
  clientPort.start();

  return new MessagePortLink({ port: clientPort });
}

/**
 * A paired browser's socket to the edge that served the page. Once it closes the page starts
 * over: to pair again if the device was unpaired, or to connect again if the backend went away.
 */
function deviceLink() {
  return new WebSocketLink({
    connectOnInit: true,
    connect() {
      const scheme = location.protocol === "https:" ? "wss" : "ws";

      const socket = new WebSocket(`${scheme}://${location.host}/rpc`, [
        DEVICE_PROTOCOL,
        deviceToken() ?? "",
      ]);

      socket.addEventListener("close", ({ code }) => {
        if (code === UNPAIRED_CLOSE_CODE) forgetDevice();

        setTimeout(
          () => location.reload(),
          code === UNPAIRED_CLOSE_CODE ? 0 : RECONNECT_MS
        );
      });

      return socket;
    },
  });
}

export const client: RouterContractClient<typeof routerContract> =
  createORPCClient(inWindow ? windowLink() : deviceLink());

export const orpc = createTanstackQueryUtils(client);

/**
 * Calls `onEvent` with each event a stream yields, for as long as the window stays open or until
 * `signal`, the one the stream was opened with, aborts it, which ends it quietly.
 */
export async function forEachEvent<T>(
  stream: Promise<AsyncIterable<T>>,
  onEvent: (event: T) => void,
  signal?: AbortSignal
) {
  try {
    for await (const event of await stream) onEvent(event);
  } catch (error) {
    if (!signal?.aborted) throw error;
  }
}
