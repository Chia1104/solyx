import { sumBy } from "es-toolkit";
import { isNetworkError, isTimeoutError } from "ky";
import * as z from "zod";

import { MINUTE_MS } from "@solyx/utils/date";
import { parseJson } from "@solyx/utils/json";

import { serverHttp } from "./server.ts";

// Ollama asks its library for the model's manifest before it answers a pull.
const PULL_TIMEOUT_MS = MINUTE_MS;

const modelsSchema = z.object({ data: z.array(z.object({ id: z.string() })) });

// A layer's bytes so far, a step such as `verifying sha256 digest`, or why the pull stopped.
const pullLineSchema = z.union([
  z.object({ error: z.string() }),
  z.object({
    status: z.string(),
    digest: z.string().optional(),
    total: z.number().nonnegative().optional(),
    completed: z.number().nonnegative().optional(),
  }),
]);

/** Bytes downloaded of the layers Ollama has named so far, which a model's first layer dwarfs. */
export interface PullProgress {
  completed: number;
  total: number;
}

export interface OllamaOptions {
  /** Its OpenAI-compatible API, such as `http://127.0.0.1:11434/v1`; its own API is at that host's root. */
  baseURL: string;
  /** @default globalThis.fetch */
  fetch?: typeof globalThis.fetch;
}

// Ollama runs a model named without a tag as its `latest`.
const tagged = (model: string) =>
  model.split("/").at(-1)?.includes(":") ? model : `${model}:latest`;

/** Each line of newline-delimited text. */
async function* lines(body: ReadableStream<Uint8Array>) {
  const decoder = new TextDecoder();
  let rest = "";

  for await (const bytes of body) {
    const parts = `${rest}${decoder.decode(bytes, { stream: true })}`.split(
      "\n"
    );

    rest = parts.pop() ?? "";
    yield* parts;
  }

  yield `${rest}${decoder.decode()}`;
}

/** The models Ollama on this computer holds, and downloading one from its library. */
export function createOllama({ baseURL, fetch }: OllamaOptions) {
  const { host, origin } = new URL(baseURL);
  const openAI = serverHttp(baseURL, { retry: 0, fetch });
  const own = serverHttp(origin, { timeout: PULL_TIMEOUT_MS, fetch });

  return {
    /**
     * Whether `model` is there to run, or `null` when nothing answers, as while Ollama is not
     * running. It reads OpenAI's `/models`, which LM Studio answers too.
     */
    async has(model: string): Promise<boolean | null> {
      let listed: unknown;

      try {
        listed = await openAI.get("models").json();
      } catch (error) {
        if (isNetworkError(error) || isTimeoutError(error)) return null;

        throw error;
      }

      const { data } = modelsSchema.parse(listed);

      return data.some(({ id }) => id === model || id === tagged(model));
    },

    /** Downloads `model` from Ollama's library, resolving once Ollama has written it. */
    async pull(
      model: string,
      onProgress: (progress: PullProgress) => void
    ): Promise<void> {
      const { body } = await own.post("api/pull", { json: { model } });

      if (!body) throw new Error(`${host} answered the pull with nothing`);

      const layers = new Map<string, PullProgress>();
      let written = false;

      for await (const line of lines(body)) {
        const event = parseJson(line, pullLineSchema);

        if (!event) continue;

        // A pull that fails after it starts still answers 200, and says why in its last line.
        if ("error" in event) throw new Error(`${host}: ${event.error}`);

        if (event.status === "success") written = true;

        if (event.digest === undefined || event.total === undefined) continue;

        layers.set(event.digest, {
          completed: event.completed ?? 0,
          total: event.total,
        });

        const sizes = [...layers.values()];

        onProgress({
          completed: sumBy(sizes, ({ completed }) => completed),
          total: sumBy(sizes, ({ total }) => total),
        });
      }

      if (!written)
        throw new Error(`${host} stopped before ${model} was written`);
    },
  };
}
