import * as z from "zod";

/** The LLM providers a user can bring a key for. Values are pi-ai's provider ids. */
export const AgentProvider = {
  Anthropic: "anthropic",
  OpenAI: "openai",
  Google: "google",
  OpenRouter: "openrouter",
} as const;

export type AgentProvider = (typeof AgentProvider)[keyof typeof AgentProvider];

export const agentProviderSchema = z.enum(AgentProvider);

/** Whether the provider can run on the user's subscription, signed in through the app's own flow, instead of a key. */
export const hasSubscription = (provider: AgentProvider) =>
  provider === AgentProvider.OpenAI;

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

/** Each provider's most capable model, used until the user picks one. */
export const DEFAULT_MODEL: Record<AgentProvider, string> = {
  [AgentProvider.Anthropic]: "claude-fable-5-1",
  [AgentProvider.OpenAI]: "gpt-6.1-sol",
  [AgentProvider.Google]: "gemini-3.1-pro-preview",
  [AgentProvider.OpenRouter]: "anthropic/claude-fable-5.1",
};
