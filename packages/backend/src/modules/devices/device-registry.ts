import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";

import * as z from "zod";

import type { PairedDevice } from "@solyx/api/devices";
import { PAIRED_DEVICES_SECRET } from "@solyx/api/settings";
import { parseJson } from "@solyx/utils/json";

import type { SecretStore } from "../settings/secret-store.ts";

const storedDeviceSchema = z.object({
  id: z.string(),
  name: z.string(),
  pairedAt: z.number(),
  /** SHA-256 of the device's token, which only the device keeps. */
  tokenHash: z.string().regex(/^[0-9a-f]{64}$/),
});

type StoredDevice = z.infer<typeof storedDeviceSchema>;

const storedDevicesSchema = z.array(storedDeviceSchema);

const hashToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");

const withoutHash = ({ id, name, pairedAt }: StoredDevice): PairedDevice => ({
  id,
  name,
  pairedAt,
});

/**
 * The devices paired with this computer, sealed with the secrets and held decrypted here, so a
 * connection is checked without waiting. None is held until it has been read, so a device that
 * connects as the app starts is turned away. Follows the store, whoever changed it.
 */
export function createDeviceRegistry(secrets: SecretStore) {
  let devices: StoredDevice[] = [];

  async function load() {
    const sealed = await secrets.get(PAIRED_DEVICES_SECRET);

    devices =
      sealed === undefined
        ? []
        : (parseJson(sealed, storedDevicesSchema) ?? []);
  }

  async function store(next: StoredDevice[]) {
    await secrets.save(PAIRED_DEVICES_SECRET, JSON.stringify(next));
    devices = next;
  }

  secrets.onChange((secret) => {
    if (secret === PAIRED_DEVICES_SECRET) void load();
  });

  void load();

  return {
    list: (): PairedDevice[] => devices.map(withoutHash),

    /** Pairs a device named `name` and answers with the token it connects with, told only once. */
    async pair(name: string) {
      const token = randomBytes(32).toString("base64url");

      const device: StoredDevice = {
        id: randomUUID(),
        name,
        pairedAt: Date.now(),
        tokenHash: hashToken(token),
      };

      await store([...devices, device]);

      return { token, device: withoutHash(device) };
    },

    /** The device `token` belongs to; `null` for a token no paired device holds. */
    verify(token: string): PairedDevice | null {
      const hash = Buffer.from(hashToken(token), "hex");

      const device = devices.find((each) =>
        timingSafeEqual(Buffer.from(each.tokenHash, "hex"), hash)
      );

      return device ? withoutHash(device) : null;
    },

    async remove(id: string) {
      await store(devices.filter((device) => device.id !== id));
    },
  };
}

export type DeviceRegistry = ReturnType<typeof createDeviceRegistry>;
