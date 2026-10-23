import { oc, type } from "@orpc/contract";
import * as z from "zod";

import type { PairedDevice, PairingCode, RemoteAccess } from "../devices.ts";

import { changesContract } from "./changes.ts";

export const devicesContract = {
  remoteAccess: oc.output(type<RemoteAccess>()),
  /** Switches the edge on or off; off, every paired device is cut off until it is on again. */
  setEnabled: oc.input(z.boolean()).output(type<void>()),
  /** A new code for one browser to pair with, in place of any shown before. */
  pairingCode: oc.output(type<PairingCode>()),
  list: oc.output(type<PairedDevice[]>()),
  /** Unpairs a device and closes its connections. */
  remove: oc.input(z.uuid()).output(type<void>()),
  /** The edge, a pairing or the paired devices changed. */
  changes: changesContract,
};
