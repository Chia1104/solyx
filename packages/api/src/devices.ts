import * as z from "zod";

/** A browser the user paired with this computer, which reaches the backend through its edge. */
export interface PairedDevice {
  id: string;
  name: string;
  /** Epoch ms. */
  pairedAt: number;
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
