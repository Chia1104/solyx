import { chunk } from "es-toolkit";
import ky, { isHTTPError } from "ky";
import * as z from "zod";

import type { Embedder } from "@solyx/core/embedding";

// Texts per request: well under every server's limit, and a collection's news fits in a few.
const BATCH = 64;

// A local server loads its model on the first request, which takes longer than ky's default allows.
const TIMEOUT_MS = 60_000;

const responseSchema = z.object({
  data: z.array(
    z.object({
      index: z.number().int().nonnegative(),
      embedding: z.array(z.number()).min(1),
    })
  ),
});

// OpenAI says what went wrong in `error.message`, Ollama in `error`.
const failureSchema = z.union([
  z
    .object({ error: z.object({ message: z.string() }) })
    .transform(({ error }) => error.message),
  z.object({ error: z.string() }).transform(({ error }) => error),
]);

interface EmbeddingsRequest {
  model: string;
  input: string[];
  encoding_format: "float";
  /** Left out to keep the model's own length, which a server without the option requires. */
  dimensions?: number;
}

export interface OpenAICompatibleOptions {
  /** Where the API lives, such as `https://api.openai.com/v1`, with or without its trailing slash. */
  baseURL: string;
  /** `undefined` for a server that takes none, such as Ollama on this computer. */
  apiKey?: string;
  model: string;
  /** The length vectors are cut to where the model allows it; `null` keeps the model's own. */
  dimensions: number | null;
  /** @default globalThis.fetch */
  fetch?: typeof globalThis.fetch;
}

/**
 * Embeddings from any server that speaks OpenAI's `/embeddings`: OpenAI's own, or a model on this
 * computer through Ollama or LM Studio.
 */
export function createOpenAICompatibleEmbedder(
  options: OpenAICompatibleOptions
): Embedder {
  const { baseURL, apiKey, model, dimensions } = options;
  const host = new URL(baseURL).host;

  const http = ky.create({
    prefix: baseURL,
    timeout: TIMEOUT_MS,
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    fetch: options.fetch,
    hooks: {
      beforeError: [
        ({ error }) => {
          if (!isHTTPError(error)) {
            error.message = `${host}: ${error.message}`;

            return error;
          }

          const reason = failureSchema.safeParse(error.data).data;

          error.message = `${host} answered ${error.response.status}${reason ? `: ${reason}` : ""}`;

          return error;
        },
      ],
    },
  });

  async function embedBatch(texts: string[], signal?: AbortSignal) {
    const request: EmbeddingsRequest = {
      model,
      input: texts,
      encoding_format: "float",
    };

    if (dimensions !== null) request.dimensions = dimensions;

    const { data } = responseSchema.parse(
      await http.post("embeddings", { json: request, signal }).json()
    );

    const vectors = data
      .toSorted((a, b) => a.index - b.index)
      .map(({ embedding }) => Float32Array.from(embedding));

    if (vectors.length !== texts.length) {
      throw new Error(
        `${host} gave ${vectors.length} vectors for ${texts.length} texts`
      );
    }

    return vectors;
  }

  return {
    space: dimensions === null ? model : `${model}/${dimensions}`,

    async embed(texts, embedOptions) {
      const vectors: Float32Array[] = [];

      for (const batch of chunk([...texts], BATCH)) {
        vectors.push(...(await embedBatch(batch, embedOptions?.signal)));
      }

      return vectors;
    },
  };
}
