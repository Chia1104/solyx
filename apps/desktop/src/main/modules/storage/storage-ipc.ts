import * as z from "zod";

import { storageChannels, storedDataSchema } from "#shared/ipc/storage.ts";
import type { StorageApi } from "#shared/ipc/storage.ts";

import { bindIpc } from "../../ipc/ipc-module.ts";
import type { Services } from "../../services.ts";

const schemas = {
  usage: z.tuple([]),
  clear: z.tuple([storedDataSchema]),
};

export function registerStorageIpc({ storage }: Services) {
  bindIpc<StorageApi>(storageChannels, schemas, storage);
}
