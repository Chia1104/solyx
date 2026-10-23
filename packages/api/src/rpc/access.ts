import { defineMeta } from "@orpc/contract";

/**
 * Marks a procedure a paired device may call. A window may call every procedure, a device only
 * those marked, so one added later reaches devices only once its contract says it should.
 */
export const [forDevices, isForDevices] = defineMeta(
  "devices",
  (incoming: boolean) => incoming
);
