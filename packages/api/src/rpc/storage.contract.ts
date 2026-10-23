import { oc, type } from "@orpc/contract";

import { storedDataSchema } from "../storage.ts";
import type { StorageUsage } from "../storage.ts";

export const storageContract = {
  usage: oc.output(type<StorageUsage>()),
  /**
   * Deletes everything of one kind and gives the space back to the disk. Charts fetch candles
   * again as they need them; the rest is gone for good, and conversations still running stop.
   */
  clear: oc.input(storedDataSchema).output(type<void>()),
};
