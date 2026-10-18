import { mandateSchema } from "@solyx/core/mandate";
import type { Mandate } from "@solyx/core/mandate";
import { parseJson } from "@solyx/utils/json";

import { MANDATE_SECRET } from "#shared/settings.ts";

import type { SecretStore } from "./secret-store.ts";

/**
 * The user's trading mandate, sealed with the secrets and held decrypted here, so the order desk
 * reads it at every proposal without waiting. None is held until it has been read, so an order
 * proposed as the app starts waits for the user. Follows the store, whoever changed it.
 */
export function createMandateStore(secrets: SecretStore) {
  let current: Mandate | null = null;

  async function load() {
    const sealed = await secrets.get(MANDATE_SECRET);

    current =
      sealed === undefined ? null : (parseJson(sealed, mandateSchema) ?? null);
  }

  secrets.onChange((secret) => {
    if (secret === MANDATE_SECRET) void load();
  });

  void load();

  return {
    current: (): Mandate | null => current,

    async save(mandate: Mandate) {
      await secrets.save(MANDATE_SECRET, JSON.stringify(mandate));
      current = mandate;
    },

    async revoke() {
      await secrets.delete(MANDATE_SECRET);
      current = null;
    },
  };
}

export type MandateStore = ReturnType<typeof createMandateStore>;
