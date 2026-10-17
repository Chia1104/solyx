import type * as z from "zod";

/** `text` read as JSON through `schema`; `undefined` where it is not JSON or does not match. */
export function parseJson<Schema extends z.ZodType>(
  text: string,
  schema: Schema
) {
  let json: unknown;

  try {
    json = JSON.parse(text);
  } catch {
    return undefined;
  }

  return schema.safeParse(json).data;
}
