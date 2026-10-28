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
 * What `run` gives, or its failure in its own words, which oRPC would replace with "Internal
 * server error": a window shows the main process's message, and the main process reports the
 * Fubon SDK's. Input that does not parse is told issue by issue, since the issues' JSON is
 * unreadable there.
 */
async function told<T>(path: readonly string[], run: () => Promise<T>) {
  try {
    return await run();
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
}

/** A stream's values, which fail as they are read, after its procedure returned it, told as `told` tells. */
async function* toldStream<T>(
  path: readonly string[],
  values: AsyncIterable<T>
): AsyncGenerator<T> {
  const stream = values[Symbol.asyncIterator]();

  try {
    for (;;) {
      const step = await told(path, () => stream.next());

      if (step.done) return;

      yield step.value;
    }
  } finally {
    // A reader that stops early ends the stream it read, as `yield*` would.
    await stream.return?.();
  }
}

/** Tells the caller of a failure in its own words, a stream's too, as `told` tells. */
export const keepMessages: ProcedureClientInterceptor<
  Context,
  Schema<unknown>,
  ErrorMap
> = async ({ next, path }) => {
  const output = await told(path, next);

  if (output instanceof Object && Symbol.asyncIterator in output) {
    // SAFETY: a procedure's output that iterates is the async iterator its contract declares.
    return toldStream(path, output as AsyncIterable<unknown>);
  }

  return output;
};
