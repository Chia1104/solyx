import * as z from "zod";

/** Where the app's embeddings come from: a model on this computer through Ollama, or OpenAI's. */
export const EmbeddingsProvider = {
  Local: "local",
  OpenAI: "openai",
} as const;

export type EmbeddingsProvider =
  (typeof EmbeddingsProvider)[keyof typeof EmbeddingsProvider];

export const embeddingsProviderSchema = z.enum(EmbeddingsProvider);

export interface EmbeddingsDefaults {
  baseURL: string;
  model: string;
  /** The length vectors are cut to; `null` keeps the model's own. */
  dimensions: number | null;
}

/** What each provider runs until the user picks otherwise. */
export const EMBEDDINGS_DEFAULTS: Record<
  EmbeddingsProvider,
  EmbeddingsDefaults
> = {
  [EmbeddingsProvider.Local]: {
    baseURL: "http://127.0.0.1:11434/v1",
    model: "qwen3-embedding:0.6b",
    dimensions: null,
  },
  // The small model reads different stories in one headline's mould as alike as one story retold.
  [EmbeddingsProvider.OpenAI]: {
    baseURL: "https://api.openai.com/v1",
    model: "text-embedding-3-large",
    dimensions: 1024,
  },
};
