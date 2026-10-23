import { implement } from "@orpc/server";

import { routerContract } from "#shared/rpc/router.contract.ts";

import type { Services } from "../services.ts";

/** Who asks: a window of the app, by its page's `webContents` id. */
export interface RpcClient {
  window: number;
}

/** What every procedure is called with: the app's services and the client that asked. */
export interface RpcContext extends Services {
  client: RpcClient;
}

export const contractOS = implement(routerContract).$context<RpcContext>();
