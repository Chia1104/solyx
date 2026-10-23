import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { isEqual } from "es-toolkit";

import type { SignedAction } from "@solyx/api/devices";
import { PRODUCT_NAME } from "@solyx/api/product";

import type { DeviceClient } from "../../rpc/context.ts";

import type { DeviceRegistry } from "./device-registry.ts";

// Long enough to add a passkey right after pairing; past it a token alone cannot add one.
const ADDING_MS = 5 * 60_000;

// Long enough to unlock a passkey; a signature asked for and not sent by then is no longer taken.
const SIGNING_MS = 2 * 60_000;

/** The domain a passkey is bound to, which browsers allow a name for but never an IP address. */
function relyingParty(origin: string) {
  const { hostname } = new URL(origin);

  if (hostname !== "localhost") {
    throw new Error(
      "A passkey works only at http://localhost, so open Solyx there"
    );
  }

  return hostname;
}

const bytes = (base64url: string) =>
  new Uint8Array(Buffer.from(base64url, "base64url"));

/**
 * The passkeys paired browsers sign submitting and cancelling orders with. A browser adds one only
 * minutes after it paired, and each signature is over a challenge given for one action, taken once.
 */
export function createPasskeys(registry: DeviceRegistry, onChange: () => void) {
  /** Devices that may still add a passkey, and the challenge they were given to. */
  const adding = new Map<string, { until: number; challenge: string | null }>();

  /** The one action each device was given a challenge to sign. */
  const signing = new Map<
    string,
    { action: SignedAction; challenge: string; until: number }
  >();

  return {
    /** Lets a device that just paired add a passkey for a few minutes. */
    paired(device: string) {
      adding.set(device, { until: Date.now() + ADDING_MS, challenge: null });
    },

    forget(device: string) {
      adding.delete(device);
      signing.delete(device);
    },

    async passkeyOptions({ device, origin }: DeviceClient) {
      const pending = adding.get(device);
      const paired = registry.get(device);

      if (!pending || !paired || Date.now() > pending.until) {
        throw new Error(
          "A passkey is added only as a browser pairs, so pair this one again"
        );
      }

      const options = await generateRegistrationOptions({
        rpName: PRODUCT_NAME,
        rpID: relyingParty(origin),
        userName: paired.name,
        userID: new TextEncoder().encode(device),
        attestationType: "none",
        authenticatorSelection: {
          residentKey: "preferred",
          userVerification: "required",
        },
      });

      pending.challenge = options.challenge;

      return options;
    },

    async addPasskey(
      { device, origin }: DeviceClient,
      answer: RegistrationResponseJSON
    ) {
      const pending = adding.get(device);

      adding.delete(device);

      if (!pending?.challenge || Date.now() > pending.until) {
        throw new Error(
          "A passkey is added only as a browser pairs, so pair this one again"
        );
      }

      const { verified, registrationInfo } = await verifyRegistrationResponse({
        response: answer,
        expectedChallenge: pending.challenge,
        expectedOrigin: origin,
        expectedRPID: relyingParty(origin),
        requireUserVerification: true,
      });

      if (!verified) throw new Error("The passkey's answer did not check");

      const { credential } = registrationInfo;

      await registry.setPasskey(device, {
        id: credential.id,
        publicKey: Buffer.from(credential.publicKey).toString("base64url"),
        counter: credential.counter,
      });
      onChange();
    },

    /** A challenge for the device's passkey to sign `action` with, in place of any it was given before. */
    async actionOptions(
      { device, origin }: DeviceClient,
      action: SignedAction
    ) {
      const passkey = registry.passkey(device);

      if (!passkey) {
        throw new Error(
          "This browser has no passkey, so pair it again and add one"
        );
      }

      const options = await generateAuthenticationOptions({
        rpID: relyingParty(origin),
        allowCredentials: [{ id: passkey.id }],
        userVerification: "required",
      });

      signing.set(device, {
        action,
        challenge: options.challenge,
        until: Date.now() + SIGNING_MS,
      });

      return options;
    },

    /** Checks that the device's passkey signed the challenge it was given for `action`, which it uses up. */
    async verifyAction(
      { device, origin }: DeviceClient,
      action: SignedAction,
      signature: AuthenticationResponseJSON
    ) {
      const asked = signing.get(device);
      const passkey = registry.passkey(device);

      signing.delete(device);

      if (
        !asked ||
        !passkey ||
        Date.now() > asked.until ||
        !isEqual(asked.action, action)
      ) {
        throw new Error("Sign this with the browser's passkey first");
      }

      const { verified, authenticationInfo } =
        await verifyAuthenticationResponse({
          response: signature,
          expectedChallenge: asked.challenge,
          expectedOrigin: origin,
          expectedRPID: relyingParty(origin),
          credential: {
            id: passkey.id,
            publicKey: bytes(passkey.publicKey),
            counter: passkey.counter,
          },
          requireUserVerification: true,
        });

      if (!verified) throw new Error("The passkey's signature did not check");

      await registry.setPasskey(device, {
        ...passkey,
        counter: authenticationInfo.newCounter,
      });
    },
  };
}
