import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/browser";
import * as z from "zod";

/** A browser the user paired with this computer, which reaches the backend through its edge. */
export interface PairedDevice {
  id: string;
  name: string;
  /** Epoch ms. */
  pairedAt: number;
  /** Whether it added a passkey as it paired, which it signs submitting and cancelling orders with. */
  signs: boolean;
}

/** A code the desktop shows for one browser to pair with, until it expires or is used. */
export interface PairingCode {
  code: string;
  /** Epoch ms. */
  expiresAt: number;
}

/** What a browser sends to pair: the code the desktop shows, and a name the user tells it by. */
export const pairingRequestSchema = z.object({
  code: z.string().trim().min(1).max(32),
  name: z.string().trim().min(1).max(80),
});

export type PairingRequest = z.infer<typeof pairingRequestSchema>;

/** What pairing answers: the device's token, which only the browser keeps, and the device. */
export const pairingSchema = z.object({
  token: z.string().min(1),
  device: z.object({
    id: z.string(),
    name: z.string(),
    pairedAt: z.number(),
    signs: z.boolean(),
  }),
});

export type Pairing = z.infer<typeof pairingSchema>;

/**
 * The WebSocket subprotocol a paired browser opens the edge's `/rpc` with, its token offered as a
 * second, since a browser can set no header on a WebSocket.
 */
export const DEVICE_PROTOCOL = "solyx";

/** The code the edge closes a socket with when its browser is not, or is no longer, paired. */
export const UNPAIRED_CLOSE_CODE = 4401;

/** Whether the edge is switched on, where it listens once it does, and why it could not. */
export interface RemoteAccess {
  enabled: boolean;
  port: number;
  /** The address to open while the edge listens; `null` while it is off or failed to start. */
  url: string | null;
  /** Why the edge could not listen, such as its port being taken. */
  error: string | null;
}

/** What a paired browser signs with its passkey, each time for one proposal or order. */
export const SignedActionKind = {
  /** Submits a proposal, as `proposals.confirm` does. */
  Confirm: "confirm",
  /** Has the broker stop watching an exit, as `proposals.cancelExit` does. */
  CancelExit: "cancel-exit",
  /** Asks the broker to cancel an order, as `account.cancel` does. */
  CancelOrder: "cancel-order",
} as const;

export type SignedActionKind =
  (typeof SignedActionKind)[keyof typeof SignedActionKind];

/** One action a paired browser signs, on the proposal or order `id` names. */
export const signedActionSchema = z.object({
  kind: z.enum(SignedActionKind),
  id: z.string().min(1).max(200),
});

export type SignedAction = z.infer<typeof signedActionSchema>;

const base64UrlSchema = z
  .string()
  .max(16_384)
  .regex(/^[A-Za-z0-9_-]*$/);

const credentialSchema = z.object({
  id: base64UrlSchema,
  rawId: base64UrlSchema,
  type: z.literal("public-key"),
  clientExtensionResults: z.record(z.string(), z.unknown()),
});

/** What a passkey answered as a browser added it, as `startRegistration` gives it. */
export const passkeyRegistrationSchema = z.custom<RegistrationResponseJSON>(
  (value) =>
    credentialSchema
      .extend({
        response: z.object({
          clientDataJSON: base64UrlSchema,
          attestationObject: base64UrlSchema,
        }),
      })
      .safeParse(value).success
);

/** What a passkey signed for one action, as `startAuthentication` gives it. */
export const passkeyAssertionSchema = z.custom<AuthenticationResponseJSON>(
  (value) =>
    credentialSchema
      .extend({
        response: z.object({
          clientDataJSON: base64UrlSchema,
          authenticatorData: base64UrlSchema,
          signature: base64UrlSchema,
        }),
      })
      .safeParse(value).success
);
