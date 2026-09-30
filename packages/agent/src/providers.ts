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

/** How long the model may think before it answers; pi-ai clamps it to what a model supports. */
export const AgentThinking = {
  Off: "off",
  Low: "low",
  Medium: "medium",
  High: "high",
} as const;

export type AgentThinking = (typeof AgentThinking)[keyof typeof AgentThinking];

export const agentThinkingSchema = z.enum(AgentThinking);

/** Each provider's most capable model, used until the user picks one. */
export const DEFAULT_MODEL: Record<AgentProvider, string> = {
  [AgentProvider.Anthropic]: "claude-fable-5-1",
  [AgentProvider.OpenAI]: "gpt-6.1-sol",
  [AgentProvider.Google]: "gemini-3.1-pro-preview",
  [AgentProvider.OpenRouter]: "anthropic/claude-fable-5.1",
};
