import * as z from "zod";

/** Entered text that must pass the schema the main process saves it under, with a localized message. */
export const matching = (schema: z.ZodType<string>, error: string) =>
  z
    .string()
    .trim()
    .refine((value) => schema.safeParse(value).success, { error });
