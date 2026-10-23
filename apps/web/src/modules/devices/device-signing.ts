import { startAuthentication } from "@simplewebauthn/browser";
import { useQuery } from "@tanstack/react-query";

import type { SignedAction } from "@solyx/api/devices";

import { inWindow } from "../../app/device.ts";
import { client } from "../../app/rpc.ts";

import { thisDeviceQuery } from "./devices-query.ts";

/** Has this browser's passkey sign `action`, which the backend then takes once. */
export async function signAction(action: SignedAction) {
  return startAuthentication({
    optionsJSON: await client.devices.actionOptions(action),
  });
}

/** Whether this client submits and cancels orders: a window always, a paired browser once it holds a passkey. */
export function useCanTrade() {
  const device = useQuery({ ...thisDeviceQuery(), enabled: !inWindow });

  return inWindow || device.data?.signs === true;
}
