import type * as z from "zod";

/**
 * Each of a list's rows that reads as `schema`. A list none of whose rows read fails, naming
 * `source` and `what` it answered, since that is the source writing the list another way, not a
 * listing or market with nothing on it.
 */
export function readRows<Row>(
  answered: readonly unknown[],
  schema: z.ZodType<Row>,
  source: string,
  what: string
): Row[] {
  const read = answered.flatMap((row) => {
    const parsed = schema.safeParse(row);

    return parsed.success ? [parsed.data] : [];
  });

  if (answered.length > 0 && read.length === 0) {
    throw new Error(
      `${source}: none of the ${answered.length} rows of ${what} read as expected`
    );
  }

  return read;
}
