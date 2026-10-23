import type { QueryClient } from "@tanstack/react-query";

import { inWindow } from "../../app/device.ts";
import { client, forEachEvent, orpc } from "../../app/rpc.ts";

/** Never stale: the backend says when the edge, a pairing or a device changes. */
export const remoteAccessQuery = () =>
  orpc.devices.remoteAccess.queryOptions({ staleTime: Infinity });

export const pairedDevicesQuery = () =>
  orpc.devices.list.queryOptions({ staleTime: Infinity });

/** Refetches the devices whenever the edge, a pairing or a device changes; a device follows none of it. */
export function followDevicesChanges(queryClient: QueryClient) {
  if (!inWindow) return;

  void forEachEvent(client.devices.changes(), () => {
    void queryClient.invalidateQueries({ queryKey: orpc.devices.key() });
  });
}
