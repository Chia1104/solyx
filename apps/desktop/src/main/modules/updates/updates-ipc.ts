import * as z from "zod";

import { updatesChannels } from "#shared/ipc/updates.ts";
import type { UpdatesApi } from "#shared/ipc/updates.ts";

import { bindIpc } from "../../ipc/ipc-module.ts";
import type { Services } from "../../services.ts";

const schemas = {
  state: z.tuple([]),
  check: z.tuple([]),
  install: z.tuple([]),
};

export function registerUpdatesIpc({ updates }: Services) {
  bindIpc<UpdatesApi>(updatesChannels, schemas, {
    state: async () => updates.state(),
    check: () => updates.check(),
    install: async () => updates.install(),
  });
}
