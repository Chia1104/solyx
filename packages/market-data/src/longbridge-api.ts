import ky, { isHTTPError } from "ky";
import * as z from "zod";

import { createRateLimiter } from "@solyx/utils/rate-limit";

import { longbridgeDataCenter } from "./longbridge-sign-in.ts";

const API_URL = "https://openapi.longbridge.com";

// Longbridge sets no limit for its HTTP API, but refuses more than one request each 0.2 seconds.
const REQUESTS_PER_SECOND = 5;

// Its descriptions in traditional Chinese, as the app names US listings.
const LANGUAGE = "zh-HK";

/**
 * A 429 means the sign-in's budget is spent elsewhere too, so it is tried again a few times, as
 * Longbridge's own SDK does, rather than failing a read or hanging it. Only a 429 throws, which is
 * what has ky try it again; any other answer is read for its reason.
 */
export const LONGBRIDGE_RETRIES = {
  retry: { limit: 5, maxRetryAfter: 10_000 },
  throwHttpErrors: (status: number) => status === 429,
};

/** A failure Longbridge reported, with its own code where it gave one. */
export class LongbridgeError extends Error {
  readonly code: number | null;

  constructor(message: string, code: number | null = null) {
    super(message);
    this.name = "LongbridgeError";
    this.code = code;
  }
}

const envelopeSchema = z.object({
  code: z.number(),
  message: z.string(),
  data: z.unknown(),
});

/** `request`'s response; a 429 still refused once its retries are spent fails naming `what` and Longbridge's reason. */
export async function longbridgeAnswer(
  request: () => Promise<Response>,
  what: string
): Promise<Response> {
  try {
    return await request();
  } catch (error) {
    if (!isHTTPError(error)) throw error;

    const reason =
      envelopeSchema.safeParse(error.data).data?.message ??
      `HTTP ${error.response.status}`;

    throw new LongbridgeError(`Longbridge refused ${what}: ${reason}`);
  }
}

export interface LongbridgeApiOptions {
  /** The signed-in user's OAuth access token, which the caller refreshes; rejects while signed out. */
  accessToken: () => Promise<string>;
  /** @default globalThis.fetch */
  fetch?: typeof fetch;
}

/** Longbridge's HTTP API on one sign-in, whose readers share its budget. */
export interface LongbridgeApi {
  /** `path`'s data as `schema` reads it; fails naming `what` and the reason Longbridge gives. */
  read<Schema extends z.ZodType>(
    path: string,
    searchParams: Record<string, string>,
    schema: Schema,
    what: string
  ): Promise<z.infer<Schema>>;
}

/**
 * Longbridge's HTTP API, fundamentals and filings among it, on the user's OAuth token, kept to
 * the pace Longbridge allows one sign-in, so every reader of one shares an instance.
 */
export function createLongbridgeApi({
  accessToken,
  fetch,
}: LongbridgeApiOptions): LongbridgeApi {
  const api = ky.create({ baseUrl: API_URL, fetch, ...LONGBRIDGE_RETRIES });

  const budget = createRateLimiter({
    limit: REQUESTS_PER_SECOND,
    windowMs: 1000,
  });

  return {
    async read(path, searchParams, schema, what) {
      const token = await accessToken();

      const response = await budget(() =>
        longbridgeAnswer(
          () =>
            api.get(path, {
              searchParams,
              headers: {
                authorization: `Bearer ${token}`,
                "x-dc-region": longbridgeDataCenter(token),
                "accept-language": LANGUAGE,
              },
            }),
          what
        )
      );

      const envelope = envelopeSchema.safeParse(
        await response.json().catch(() => null)
      );

      if (!envelope.success) {
        throw new LongbridgeError(
          `Longbridge answered ${what} with HTTP ${response.status}`
        );
      }

      const { code, message, data } = envelope.data;

      if (code !== 0) {
        throw new LongbridgeError(
          `Longbridge refused ${what}: ${message}`,
          code
        );
      }

      const read = schema.safeParse(data);

      if (!read.success) {
        throw new LongbridgeError(`Longbridge's ${what} did not read`);
      }

      return read.data;
    },
  };
}
