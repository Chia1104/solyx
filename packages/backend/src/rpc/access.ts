import { ORPCError } from "@orpc/server";
import type {
  ErrorMap,
  ProcedureClientInterceptor,
  Schema,
} from "@orpc/server";

import { isForDevices } from "@solyx/api/rpc/access";

import { ClientKind } from "./context.ts";
import type { RpcClient } from "./context.ts";

/**
 * Refuses a device every procedure its contract does not open to devices, before its input is
 * read, so a device reaches only what was decided it may.
 */
export const onlyWhatDevicesMayCall: ProcedureClientInterceptor<
  { client: RpcClient },
  Schema<unknown>,
  ErrorMap
> = ({ context, next, path, procedure }) => {
  if (context.client.kind === ClientKind.Device && !isForDevices(procedure)) {
    throw new ORPCError("FORBIDDEN", {
      message: `${path.join(".")} is for this computer's own windows`,
    });
  }

  return next();
};
