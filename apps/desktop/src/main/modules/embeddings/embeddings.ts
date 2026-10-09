import type { Embedder } from "@solyx/core/embedding";
import { STORY_LINES } from "@solyx/core/news";
import { createOpenAICompatibleEmbedder } from "@solyx/embeddings/openai-compatible";
import {
  EMBEDDINGS_DEFAULTS,
  EmbeddingsProvider,
} from "@solyx/embeddings/provider";

import { Secret } from "#shared/ipc/settings.ts";
import type { EmbeddingsSettings } from "#shared/ipc/settings.ts";

import type { ConfigFile } from "../settings/config-file.ts";
import type { SecretStore } from "../settings/secret-store.ts";

export interface EmbeddingsOptions {
  config: ConfigFile;
  secrets: SecretStore;
}

/**
 * The embedder the config file and the saved key pick, read afresh for every collection and read,
 * so a changed setting applies without a restart.
 */
export function createEmbeddings({ config, secrets }: EmbeddingsOptions) {
  function read() {
    const { enabled, provider, local, openai } = config.read().embeddings;
    const defaults = EMBEDDINGS_DEFAULTS[provider];
    const set = provider === EmbeddingsProvider.Local ? local : openai;

    return {
      enabled,
      provider,
      endpoint: {
        baseURL: set.baseURL ?? defaults.baseURL,
        model: set.model ?? defaults.model,
        dimensions: defaults.dimensions,
      },
    };
  }

  return {
    /** `undefined` while switched off, or until OpenAI's key is saved. */
    async embedder(): Promise<Embedder | undefined> {
      const { enabled, provider, endpoint } = read();

      if (!enabled) return undefined;

      if (provider === EmbeddingsProvider.Local) {
        return createOpenAICompatibleEmbedder(endpoint);
      }

      const apiKey = await secrets.get(Secret.EmbeddingsApiKey);

      return apiKey === undefined
        ? undefined
        : createOpenAICompatibleEmbedder({ ...endpoint, apiKey });
    },

    /**
     * The embedder for the user's own text, such as reports, memories and what the agent searches
     * for: only a model on this computer, so that text never leaves it.
     */
    localEmbedder(): Embedder | undefined {
      const { enabled, provider, endpoint } = read();

      return enabled && provider === EmbeddingsProvider.Local
        ? createOpenAICompatibleEmbedder(endpoint)
        : undefined;
    },

    settings(): EmbeddingsSettings {
      const { enabled, provider, endpoint } = read();
      const { space } = createOpenAICompatibleEmbedder(endpoint);

      return {
        enabled,
        provider,
        space,
        measured: STORY_LINES.has(space),
      };
    },
  };
}

export type Embeddings = ReturnType<typeof createEmbeddings>;
