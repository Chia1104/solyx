import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";

import { Mutex } from "es-toolkit";
import * as z from "zod";

import type { PairedDevice } from "@solyx/api/devices";
import { PAIRED_DEVICES_SECRET } from "@solyx/api/settings";
import { parseJson } from "@solyx/utils/json";

import type { SecretStore } from "../settings/secret-store.ts";

const storedPasskeySchema = z.object({
  /** The credential's id, base64url. */
  id: z.string(),
  /** Its COSE public key, base64url. */
  publicKey: z.string(),
  /** How many times the authenticator says it has signed, which only rises unless it is always 0. */
  counter: z.number().int().nonnegative(),
});

export type StoredPasskey = z.infer<typeof storedPasskeySchema>;

const storedDeviceSchema = z.object({
  id: z.string(),
  name: z.string(),
  pairedAt: z.number(),
  /** SHA-256 of the device's token, which only the device keeps. */
  tokenHash: z.string().regex(/^[0-9a-f]{64}$/),
  passkey: storedPasskeySchema.nullable(),
});

type StoredDevice = z.infer<typeof storedDeviceSchema>;

const storedDevicesSchema = z.array(storedDeviceSchema);

const hashToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");

const shown = ({
  id,
  name,
  pairedAt,
  passkey,
}: StoredDevice): PairedDevice => ({
  id,
  name,
  pairedAt,
  signs: passkey !== null,
});

/**
 * The devices paired with this computer, sealed with the secrets and held decrypted here, so a
 * connection is checked without waiting. None is held until it has been read, so a device that
 * connects as the app starts is turned away. Follows the store, whoever changed it.
 */
export function createDeviceRegistry(secrets: SecretStore) {
  // One read or change at a time, each from what the one before kept, so none writes back a
  // device another removed.
  const mutex = new Mutex();

  let devices: StoredDevice[] = [];

  async function load() {
    await mutex.acquire();

    try {
      const sealed = await secrets.get(PAIRED_DEVICES_SECRET);

      devices =
        sealed === undefined
          ? []
          : (parseJson(sealed, storedDevicesSchema) ?? []);
    } finally {
      mutex.release();
    }
  }

  /** Keeps what `next` makes of the devices as every earlier change left them. */
  async function change(next: (current: StoredDevice[]) => StoredDevice[]) {
    await mutex.acquire();

    try {
      const changed = next(devices);

      await secrets.save(PAIRED_DEVICES_SECRET, JSON.stringify(changed));
      devices = changed;
    } finally {
      mutex.release();
    }
  }

  secrets.onChange((secret) => {
    if (secret === PAIRED_DEVICES_SECRET) void load();
  });

  void load();

  return {
    list: (): PairedDevice[] => devices.map(shown),

    /** Pairs a device named `name` and answers with the token it connects with, told only once. */
    async pair(name: string) {
      const token = randomBytes(32).toString("base64url");

      const device: StoredDevice = {
        id: randomUUID(),
        name,
        pairedAt: Date.now(),
        tokenHash: hashToken(token),
        passkey: null,
      };

      await change((current) => [...current, device]);

      return { token, device: shown(device) };
    },

    /** The device `token` belongs to; `null` for a token no paired device holds. */
    verify(token: string): PairedDevice | null {
      const hash = Buffer.from(hashToken(token), "hex");

      const device = devices.find((each) =>
        timingSafeEqual(Buffer.from(each.tokenHash, "hex"), hash)
      );

      return device ? shown(device) : null;
    },

    get(id: string): PairedDevice | null {
      const device = devices.find((each) => each.id === id);

      return device ? shown(device) : null;
    },

    passkey: (id: string) =>
      devices.find((device) => device.id === id)?.passkey ?? null,

    /**
     * Keeps the passkey a device added, or the count its authenticator gave as it signed. A device
     * unpaired meanwhile is refused, so what it signed is not taken.
     */
    async setPasskey(id: string, passkey: StoredPasskey) {
      await change((current) => {
        if (!current.some((device) => device.id === id)) {
          throw new Error("This browser is no longer paired");
        }

        return current.map((device) =>
          device.id === id ? { ...device, passkey } : device
        );
      });
    },

    async remove(id: string) {
      await change((current) => current.filter((device) => device.id !== id));
    },
  };
}

export type DeviceRegistry = ReturnType<typeof createDeviceRegistry>;
