import { zstdDecompressSync } from "node:zlib";

import type * as z from "zod";

/** Parses the JSON a request carried; TypeSafe's client compresses bodies of 1 KiB or more with zstd. */
export async function readSent<T extends z.ZodType>(
  request: Request,
  schema: T
) {
  const bytes = new Uint8Array(await request.arrayBuffer());

  const body =
    request.headers.get("Content-Encoding") === "zstd"
      ? zstdDecompressSync(bytes)
      : bytes;

  return schema.parse(JSON.parse(new TextDecoder().decode(body)));
}
