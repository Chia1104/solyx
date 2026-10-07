import * as z from "zod";

import { storageChannels, storedDataSchema } from "#shared/ipc/storage.ts";
import type { StorageApi } from "#shared/ipc/storage.ts";

import { bindIpc } from "../../ipc/ipc-module.ts";
import type { Services } from "../../services.ts";

import { createStorageApi } from "./storage-api.ts";

const schemas = {
  usage: z.tuple([]),
  clear: z.tuple([storedDataSchema]),
};

export function registerStorageIpc({
  cache,
  agent,
  memories,
  newsData,
  research,
  userData,
}: Services) {
  bindIpc<StorageApi>(
    storageChannels,
    schemas,
    createStorageApi({
      cache,
      agent,
      memories,
      news: newsData,
      research,
      watchlist: userData.watchlist,
    })
  );
}
