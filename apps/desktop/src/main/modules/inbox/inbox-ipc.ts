import * as z from "zod";

import { inboxChannels } from "#shared/ipc/inbox.ts";
import type { InboxApi } from "#shared/ipc/inbox.ts";

import { bindIpc } from "../../ipc/ipc-module.ts";
import type { Services } from "../../services.ts";

const schemas = {
  list: z.tuple([]),
};

export function registerInboxIpc({ inbox }: Services) {
  bindIpc<InboxApi>(inboxChannels, schemas, {
    list: () => inbox.list(),
  });
}
