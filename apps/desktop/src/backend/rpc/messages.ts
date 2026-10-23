import { ValidationError } from "@orpc/contract";
import { ORPCError } from "@orpc/server";
import type {
  Context,
  ErrorMap,
  ProcedureClientInterceptor,
  Schema,
} from "@orpc/server";
import * as z from "zod";

import { errorMessage } from "@solyx/utils/error";

/**
 * Tells the caller of a failure in its own words, which oRPC would replace with "Internal server
 * error": a window shows the main process's message, and the main process reports the Fubon SDK's.
 * Input that does not parse is told issue by issue, since the issues' JSON is unreadable there.
 */
export const keepMessages: ProcedureClientInterceptor<
  Context,
  Schema<unknown>,
  ErrorMap
> = async ({ next, path }) => {
  try {
    return await next();
  } catch (error) {
    if (!(error instanceof ORPCError)) {
      throw new ORPCError("INTERNAL_SERVER_ERROR", {
        message: errorMessage(error),
        cause: error,
      });
    }

    if (error.cause instanceof ValidationError) {
      throw new ORPCError("BAD_REQUEST", {
        message: `Invalid input for ${path.join(".")}: ${z.prettifyError(error.cause)}`,
        cause: error.cause,
      });
    }

    throw error;
  }
};
