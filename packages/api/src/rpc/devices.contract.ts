import { oc, type } from "@orpc/contract";
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/browser";
import * as z from "zod";

import { passkeyRegistrationSchema, signedActionSchema } from "../devices.ts";
import type { PairedDevice, PairingCode, RemoteAccess } from "../devices.ts";

import { forDevices } from "./access.ts";
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
  /** The paired browser asking; `null` for this computer's windows. */
  thisDevice: oc.meta(forDevices(true)).output(type<PairedDevice | null>()),
  /**
   * What the asking browser hands its authenticator to add a passkey, which it may do once and only
   * minutes after it paired, so a token taken later cannot add one.
   */
  passkeyOptions: oc
    .meta(forDevices(true))
    .output(type<PublicKeyCredentialCreationOptionsJSON>()),
  /** Keeps the passkey the asking browser added, once its answer checks against those options. */
  addPasskey: oc
    .meta(forDevices(true))
    .input(passkeyRegistrationSchema)
    .output(type<void>()),
  /** What the asking browser's passkey signs to take one action, good once and for minutes. */
  actionOptions: oc
    .meta(forDevices(true))
    .input(signedActionSchema)
    .output(type<PublicKeyCredentialRequestOptionsJSON>()),
};
