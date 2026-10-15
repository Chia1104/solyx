import { implement } from "@orpc/server";
import type { WebContents } from "electron";

import { routerContract } from "#shared/rpc/router.contract.ts";

import type { Services } from "../services.ts";

/** What every procedure is called with: the app's services and the window that asked. */
export interface RpcContext extends Services {
  sender: WebContents;
}

export const contractOS = implement(routerContract).$context<RpcContext>();
