import * as z from "zod";

import { Secret, settingsChannels } from "#shared/ipc/settings.ts";
import type { SettingsApi } from "#shared/ipc/settings.ts";

import { ipcModule } from "../../ipc/ipc-module.ts";
import type { Services } from "../../services.ts";

const secretSchema = z.enum(Secret);

const handle = ipcModule<SettingsApi>(settingsChannels, {
  secrets: z.tuple([]),
  saveSecret: z.tuple([secretSchema, z.string().trim().min(1).max(1024)]),
  deleteSecret: z.tuple([secretSchema]),
  providerPlans: z.tuple([]),
  setProviderPlan: z.tuple([z.literal("fugle"), z.string()]),
});

export function registerSettingsIpc({
  secrets,
  liveCandles,
  providerPlans,
}: Services) {
  handle("secrets", async () => ({
    available: await secrets.available(),
    states: await secrets.states(),
  }));

  // The live stream authenticates once per connection, so a changed key reopens it.
  handle("saveSecret", async (secret, value) => {
    await secrets.save(secret, value);
    await liveCandles.restart();
  });

  handle("deleteSecret", async (secret) => {
    await secrets.delete(secret);
    await liveCandles.restart();
  });

  handle("providerPlans", async () => providerPlans.current());

  handle("setProviderPlan", (provider, plan) =>
    providerPlans.set(provider, plan)
  );
}
