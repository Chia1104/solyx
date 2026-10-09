import { isEnumValue } from "@solyx/utils/is";

import { createOpenAICompatibleEmbedder } from "../src/openai-compatible.ts";
import { EMBEDDINGS_DEFAULTS, EmbeddingsProvider } from "../src/provider.ts";

function required(name: string): string {
  const value = process.env[name];

  if (!value) throw new Error(`Set ${name}`);

  return value;
}

function dimensionsOf(value: string | undefined, fallback: number | null) {
  if (value === undefined) return fallback;

  return value === "native" ? null : Number(value);
}

/**
 * The embedder the scripts measure: OpenAI on `OPENAI_API_KEY` unless `EMBEDDINGS_PROVIDER` is
 * local, with `EMBEDDINGS_MODEL` and `EMBEDDINGS_DIMENSIONS` (`native` keeps the model's own
 * length) in place of the provider's defaults.
 */
export function embedderFromEnv() {
  const provider = process.env.EMBEDDINGS_PROVIDER ?? EmbeddingsProvider.OpenAI;

  if (!isEnumValue(EmbeddingsProvider, provider)) {
    throw new Error(`EMBEDDINGS_PROVIDER is local or openai, not ${provider}`);
  }

  const defaults = EMBEDDINGS_DEFAULTS[provider];

  return createOpenAICompatibleEmbedder({
    baseURL: defaults.baseURL,
    apiKey:
      provider === EmbeddingsProvider.OpenAI
        ? required("OPENAI_API_KEY")
        : undefined,
    model: process.env.EMBEDDINGS_MODEL ?? defaults.model,
    dimensions: dimensionsOf(
      process.env.EMBEDDINGS_DIMENSIONS,
      defaults.dimensions
    ),
  });
}
