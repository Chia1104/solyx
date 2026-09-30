import { createModelCatalog } from "@solyx/agent/models";
import {
  AgentProvider,
  AgentThinking,
  DEFAULT_MODEL,
  agentProviderSchema,
  agentThinkingSchema,
} from "@solyx/agent/providers";
import type { AgentModelChoice } from "@solyx/agent/runtime";

import { AGENT_PROVIDER_SECRET, SecretState } from "#shared/ipc/settings.ts";
import type { AgentSettings } from "#shared/ipc/settings.ts";

import type { ConfigFile } from "../settings/config-file.ts";
import type { SecretStore } from "../settings/secret-store.ts";

/**
 * The model the agent runs on, as the config file and the saved keys pick it. An entry that no
 * longer parses reads as its default, and a model the provider does not list as the provider's.
 */
export function createAgentModels({
  config,
  secrets,
}: {
  config: ConfigFile;
  secrets: SecretStore;
}) {
  const catalog = createModelCatalog();

  function selection() {
    const saved = config.read().agent;

    const provider =
      agentProviderSchema.safeParse(saved?.provider).data ??
      AgentProvider.Anthropic;

    const model = catalog.getModel(
      provider,
      saved?.model ?? DEFAULT_MODEL[provider]
    );

    return {
      provider,
      model: model ?? catalog.getModel(provider, DEFAULT_MODEL[provider]),
      thinking:
        agentThinkingSchema.safeParse(saved?.thinking).data ??
        AgentThinking.Medium,
    };
  }

  return {
    catalog,

    async settings(): Promise<AgentSettings> {
      const { provider, model, thinking } = selection();
      const states = await secrets.states();

      return {
        provider,
        model: model?.id ?? DEFAULT_MODEL[provider],
        thinking,
        models: catalog.getModels(provider).map((option) => ({
          id: option.id,
          name: option.name,
          reasoning: option.reasoning,
        })),
        ready:
          model !== undefined &&
          states[AGENT_PROVIDER_SECRET[provider]] === SecretState.Saved,
      };
    },

    async choice(): Promise<AgentModelChoice> {
      const { provider, model, thinking } = selection();

      if (!model) {
        throw new Error(`Pick a model for ${provider} in Settings first`);
      }

      const apiKey = await secrets.get(AGENT_PROVIDER_SECRET[provider]);

      if (!apiKey) {
        throw new Error(`Save an API key for ${provider} in Settings first`);
      }

      return { model, apiKey, thinking };
    },
  };
}

export type AgentModels = ReturnType<typeof createAgentModels>;
