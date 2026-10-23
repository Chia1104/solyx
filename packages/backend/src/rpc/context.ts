import { implement } from "@orpc/server";

import { routerContract } from "@solyx/api/rpc/router.contract";

import type { Services } from "../services.ts";

/** Who asks: a window of the app, or a device paired with it through the edge. */
export const ClientKind = {
  Window: "window",
  Device: "device",
} as const;

export type ClientKind = (typeof ClientKind)[keyof typeof ClientKind];

/** The asking window by its page's `webContents` id, or the asking device by its id. */
export type RpcClient =
  | { kind: typeof ClientKind.Window; window: number }
  | { kind: typeof ClientKind.Device; device: string };

/** What every procedure is called with: the app's services and the client that asked. */
export interface RpcContext extends Services {
  client: RpcClient;
}

export const contractOS = implement(routerContract).$context<RpcContext>();
