import * as z from "zod";

import { accountChannels } from "#shared/ipc/account.ts";
import type { AccountApi } from "#shared/ipc/account.ts";

import { ipcModule } from "../../ipc/ipc-module.ts";
import type { Services } from "../../services.ts";

const handle = ipcModule<AccountApi>(accountChannels, {
  summary: z.tuple([]),
});

export function registerAccountIpc({ desk }: Services) {
  handle("summary", async () => ({
    brokerMode: desk.mode,
    ...(await desk.account()),
  }));
}
