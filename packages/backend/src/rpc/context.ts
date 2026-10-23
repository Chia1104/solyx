import { implement } from "@orpc/server";

import { routerContract } from "@solyx/api/rpc/router.contract";

import type { Services } from "../services.ts";

/** Who asks: a window of the app, or a device paired with it through the edge. */
export const ClientKind = {
  Window: "window",
  Device: "device",
} as const;

export type ClientKind = (typeof ClientKind)[keyof typeof ClientKind];

/** A paired device by its id, and the origin of the page it connected from. */
export interface DeviceClient {
  kind: typeof ClientKind.Device;
  device: string;
  origin: string;
}

/** The asking window by its page's `webContents` id, or the asking device. */
export type RpcClient =
  | { kind: typeof ClientKind.Window; window: number }
  | DeviceClient;

/** What every procedure is called with: the app's services and the client that asked. */
export interface RpcContext extends Services {
  client: RpcClient;
}

export const contractOS = implement(routerContract).$context<RpcContext>();
