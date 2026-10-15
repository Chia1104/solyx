import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/message-port";
import type { RouterContractClient } from "@orpc/contract";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";

import type { SymbolRef } from "@solyx/core/market";

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
 * A listing as an input names it, so a `Listing` or a route's params key the same query as the
 * bare `SymbolRef`, since an input is its query's key.
 */
export function symbolInput({ market, symbol }: SymbolRef): SymbolRef {
  return { market, symbol };
}

/** Calls `onEvent` with each event a stream yields, for as long as the window stays open. */
export async function forEachEvent<T>(
  stream: Promise<AsyncIterable<T>>,
  onEvent: (event: T) => void
) {
  for await (const event of await stream) onEvent(event);
}
