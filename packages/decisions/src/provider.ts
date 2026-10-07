import * as z from "zod";

/** The vendors whose decisions models the app can run, one module each. */
export const DecisionsProvider = {
  TypeSafe: "typesafe",
  Cloudflare: "cloudflare",
  OpenAI: "openai",
} as const;

export type DecisionsProvider =
  (typeof DecisionsProvider)[keyof typeof DecisionsProvider];

export const decisionsProviderSchema = z.enum(DecisionsProvider);
