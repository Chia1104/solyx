import * as z from "zod";

import { accountChannels } from "#shared/ipc/account.ts";
import type { AccountApi } from "#shared/ipc/account.ts";

import { bindIpc } from "../../ipc/ipc-module.ts";
import type { Services } from "../../services.ts";

export function registerAccountIpc({ desk }: Services) {
  bindIpc<AccountApi>(
    accountChannels,
    { summary: z.tuple([]) },
    {
      summary: async () => ({
        brokerMode: desk.mode,
        ...(await desk.account()),
      }),
    }
  );
}
