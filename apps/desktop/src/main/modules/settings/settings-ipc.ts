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
});

export function registerSettingsIpc({ secrets }: Services) {
  handle("secrets", async () => ({
    available: await secrets.available(),
    states: await secrets.states(),
  }));

  handle("saveSecret", (secret, value) => secrets.save(secret, value));

  handle("deleteSecret", (secret) => secrets.delete(secret));
}
