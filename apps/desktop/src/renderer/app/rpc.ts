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
