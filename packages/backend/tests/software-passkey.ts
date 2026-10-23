import {
  createHash,
  generateKeyPairSync,
  randomBytes,
  sign,
} from "node:crypto";

import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";

/** A CBOR item's head: its major type and its length or value, up to 16 bits. */
function head(major: number, length: number) {
  if (length < 24) return [(major << 5) | length];

  if (length < 256) return [(major << 5) | 24, length];

  return [(major << 5) | 25, length >> 8, length & 0xff];
}

// CBOR as an authenticator writes it, for the few kinds of item a passkey's answer holds.
const int = (value: number) =>
  value >= 0 ? head(0, value) : head(1, -1 - value);

const bytes = (value: Uint8Array) => [...head(2, value.length), ...value];

const text = (value: string) => {
  const encoded = Buffer.from(value);

  return [...head(3, encoded.length), ...encoded];
};

const map = (entries: [number[], number[]][]) => [
  ...head(5, entries.length),
  ...entries.flat(2),
];

const uint = (value: number, size: number) => {
  const buffer = Buffer.alloc(size);

  buffer.writeUIntBE(value, 0, size);

  return buffer;
};

// User present and verified, with attested credential data while adding.
const PRESENT_AND_VERIFIED = 0x05;

const WITH_CREDENTIAL = 0x40;

/**
 * An authenticator in memory with one ES256 key, which answers as a browser's passkey would on a
 * page at `origin`: adding itself, then signing each challenge with a count that rises.
 */
export function softwarePasskey(origin: string) {
  const { privateKey, publicKey } = generateKeyPairSync("ec", {
    namedCurve: "P-256",
  });

  const { x, y } = publicKey.export({ format: "jwk" });
  const id = randomBytes(16).toString("base64url");

  const rpIdHash = createHash("sha256")
    .update(new URL(origin).hostname)
    .digest();

  let counter = 0;

  const clientData = (type: string, challenge: string, from: string) =>
    Buffer.from(JSON.stringify({ type, challenge, origin: from }));

  return {
    register(
      options: PublicKeyCredentialCreationOptionsJSON
    ): RegistrationResponseJSON {
      const key = map([
        [int(1), int(2)],
        [int(3), int(-7)],
        [int(-1), int(1)],
        [int(-2), bytes(Buffer.from(x ?? "", "base64url"))],
        [int(-3), bytes(Buffer.from(y ?? "", "base64url"))],
      ]);

      const credentialId = Buffer.from(id, "base64url");

      const authenticatorData = Buffer.concat([
        rpIdHash,
        Buffer.from([PRESENT_AND_VERIFIED | WITH_CREDENTIAL]),
        uint(counter, 4),
        Buffer.alloc(16),
        uint(credentialId.length, 2),
        credentialId,
        Buffer.from(key),
      ]);

      const attestation = map([
        [text("fmt"), text("none")],
        [text("attStmt"), map([])],
        [text("authData"), bytes(authenticatorData)],
      ]);

      return {
        id,
        rawId: id,
        type: "public-key",
        response: {
          clientDataJSON: clientData(
            "webauthn.create",
            options.challenge,
            origin
          ).toString("base64url"),
          attestationObject: Buffer.from(attestation).toString("base64url"),
        },
        clientExtensionResults: {},
      };
    },

    /** Signs the challenge as a page at `from` asked for it, this computer's own page unless named. */
    sign(
      options: PublicKeyCredentialRequestOptionsJSON,
      from = origin
    ): AuthenticationResponseJSON {
      counter += 1;

      const authenticatorData = Buffer.concat([
        rpIdHash,
        Buffer.from([PRESENT_AND_VERIFIED]),
        uint(counter, 4),
      ]);

      const data = clientData("webauthn.get", options.challenge, from);

      const signature = sign(
        "sha256",
        Buffer.concat([
          authenticatorData,
          createHash("sha256").update(data).digest(),
        ]),
        privateKey
      );

      return {
        id,
        rawId: id,
        type: "public-key",
        response: {
          clientDataJSON: data.toString("base64url"),
          authenticatorData: authenticatorData.toString("base64url"),
          signature: signature.toString("base64url"),
        },
        clientExtensionResults: {},
      };
    },
  };
}
