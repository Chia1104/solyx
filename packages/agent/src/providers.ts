import * as z from "zod";

/**
 * An LLM provider by pi-ai's id for it, such as `anthropic`. The host's model catalog decides
 * which ids it offers, so the shape is all a schema can check.
 */
export const agentProviderSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]*$/)
  .max(64);

export type AgentProvider = z.infer<typeof agentProviderSchema>;

/** What new conversations run on until the user picks another provider. */
export const DEFAULT_PROVIDER: AgentProvider = "anthropic";

/** The one provider that can run on a subscription, OpenAI on ChatGPT, through the app's own sign-in. */
export const SUBSCRIPTION_PROVIDER: AgentProvider = "openai";

/** Whether the provider can run on the user's subscription, signed in through the app's own flow, instead of a key. */
export const hasSubscription = (provider: AgentProvider) =>
  provider === SUBSCRIPTION_PROVIDER;

/** How the provider is paid for: per request on an API key, or on the user's subscription plan. */
export const AgentAuth = {
  ApiKey: "api-key",
  Subscription: "subscription",
} as const;

export type AgentAuth = (typeof AgentAuth)[keyof typeof AgentAuth];

export const agentAuthSchema = z.enum(AgentAuth);

/** How long the model may think before it answers; pi-ai clamps it to what a model supports. */
export const AgentThinking = {
  Off: "off",
  Low: "low",
  Medium: "medium",
  High: "high",
} as const;

export type AgentThinking = (typeof AgentThinking)[keyof typeof AgentThinking];

export const agentThinkingSchema = z.enum(AgentThinking);

/** A model, named by its provider and that provider's id for it; neither half alone is a key. */
export const agentModelRefSchema = z.object({
  provider: agentProviderSchema,
  id: z.string().min(1).max(200),
});

export type AgentModelRef = z.infer<typeof agentModelRefSchema>;

/** What a conversation runs on in place of the user's defaults; `null` follows the default. */
export const agentModelPickSchema = z.object({
  model: agentModelRefSchema.nullable(),
  thinking: agentThinkingSchema.nullable(),
});

export type AgentModelPick = z.infer<typeof agentModelPickSchema>;
