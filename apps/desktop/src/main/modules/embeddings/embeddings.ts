import { throttle } from "es-toolkit";

import type { Embedder } from "@solyx/core/embedding";
import { STORY_LINES } from "@solyx/core/news";
import { createOllama } from "@solyx/embeddings/ollama";
import type { PullProgress } from "@solyx/embeddings/ollama";
import { createOpenAICompatibleEmbedder } from "@solyx/embeddings/openai-compatible";
import {
  EMBEDDINGS_DEFAULTS,
  EmbeddingsProvider,
} from "@solyx/embeddings/provider";
import { errorMessage } from "@solyx/utils/error";

import { LocalModelStatus } from "#shared/embeddings.ts";
import type { LocalModelState } from "#shared/embeddings.ts";
import { Secret } from "#shared/settings.ts";
import type { EmbeddingsSettings } from "#shared/settings.ts";

import type { ConfigFile } from "../settings/config-file.ts";
import type { SecretStore } from "../settings/secret-store.ts";
import type { Diagnostics } from "../telemetry/diagnostics.ts";

// Often enough for a bar to move smoothly, seldom enough that windows reading it again cost nothing.
const PROGRESS_EVERY_MS = 500;

export interface EmbeddingsOptions {
  config: ConfigFile;
  secrets: SecretStore;
  diagnostics: Pick<Diagnostics, "recovered">;
  /** Told as a pull of the model on this computer starts, moves on and ends. */
  onChange: () => void;
  /** @default globalThis.fetch */
  fetch?: typeof globalThis.fetch;
}

/**
 * The embedder the config file and the saved key pick, read afresh for every collection and read,
 * so a changed setting applies without a restart, and the model on this computer it runs.
 */
export function createEmbeddings({
  config,
  secrets,
  diagnostics,
  onChange,
  fetch,
}: EmbeddingsOptions) {
  // By where the model runs and its name, since a pull goes on for what was named when it started.
  const pulls = new Map<string, PullProgress>();
  const failures = new Map<string, string>();
  const progressed = throttle(onChange, PROGRESS_EVERY_MS);

  function endpoint(provider: EmbeddingsProvider) {
    const set = config.read().embeddings[provider];
    const defaults = EMBEDDINGS_DEFAULTS[provider];

    return {
      baseURL: set.baseURL ?? defaults.baseURL,
      model: set.model ?? defaults.model,
      dimensions: defaults.dimensions,
    };
  }

  function read() {
    const { enabled, provider } = config.read().embeddings;

    return { enabled, provider, endpoint: endpoint(provider) };
  }

  function local() {
    const { baseURL, model } = endpoint(EmbeddingsProvider.Local);

    return { baseURL, model, key: `${baseURL} ${model}` };
  }

  async function pull({ baseURL, model, key }: ReturnType<typeof local>) {
    pulls.set(key, { completed: 0, total: 0 });
    failures.delete(key);
    onChange();

    try {
      await createOllama({ baseURL, fetch }).pull(model, (progress) => {
        pulls.set(key, progress);
        progressed();
      });
    } catch (error) {
      failures.set(key, errorMessage(error));
      diagnostics.recovered(error, "embeddings.pull", { model });
    } finally {
      pulls.delete(key);
      onChange();
    }
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

    /** What the server on this computer has of the model the local settings name, whichever provider is picked. */
    async localModel(): Promise<LocalModelState> {
      const { baseURL, model, key } = local();
      const pull = pulls.get(key);

      if (pull) return { status: LocalModelStatus.Pulling, model, ...pull };

      const has = await createOllama({ baseURL, fetch }).has(model);

      if (has === null) {
        return {
          status: LocalModelStatus.Unreachable,
          model,
          host: new URL(baseURL).host,
        };
      }

      return has
        ? { status: LocalModelStatus.Ready, model }
        : {
            status: LocalModelStatus.Missing,
            model,
            failure: failures.get(key) ?? null,
          };
    },

    /** Has Ollama download that model, unless it already is; it goes on whoever is watching. */
    pullLocalModel() {
      const target = local();

      if (!pulls.has(target.key)) void pull(target);
    },
  };
}

export type Embeddings = ReturnType<typeof createEmbeddings>;
