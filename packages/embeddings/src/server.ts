import ky, { isHTTPError } from "ky";
import type { KyInstance, Options } from "ky";
import * as z from "zod";

// OpenAI says what went wrong in `error.message`, Ollama in `error`.
const failureSchema = z.union([
  z
    .object({ error: z.object({ message: z.string() }) })
    .transform(({ error }) => error.message),
  z.object({ error: z.string() }).transform(({ error }) => error),
]);

/** Requests under `prefix`, whose failures name the server's host and the reason it gives. */
export function serverHttp(
  prefix: string,
  options: Omit<Options, "prefix" | "hooks">
): KyInstance {
  const host = new URL(prefix).host;

  return ky.create({
    ...options,
    prefix,
    hooks: {
      beforeError: [
        ({ error }) => {
          if (!isHTTPError(error)) {
            error.message = `${host}: ${error.message}`;

            return error;
          }

          const reason = failureSchema.safeParse(error.data).data;

          error.message = `${host} answered ${error.response.status}${reason ? `: ${reason}` : ""}`;

          return error;
        },
      ],
    },
  });
}
