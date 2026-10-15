import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/message-port";
import type { RouterContractClient } from "@orpc/contract";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";

import { RPC_CONNECT } from "#shared/rpc/connect.ts";
import type { routerContract } from "#shared/rpc/router.contract.ts";

const { port1: clientPort, port2: serverPort } = new MessageChannel();

// The preload forwards this end to the main process, which serves every procedure on it for as
// long as the page stays open.
window.postMessage(RPC_CONNECT, "*", [serverPort]);

clientPort.start();

export const client: RouterContractClient<typeof routerContract> =
  createORPCClient(new RPCLink({ port: clientPort }));

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
