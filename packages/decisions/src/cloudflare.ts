import { noul } from "@typesafe-ai/sdk";
import * as z from "zod";

import type { SentimentScorer } from "@solyx/core/sentiment";

import type { CommandJudge } from "./command.ts";
import {
  COMMAND_QUESTIONS,
  createCommandJudge,
  createScorer,
} from "./system-one.ts";
import type { Ask } from "./system-one.ts";

/** Workers AI serves Clef under unversioned ids: `clef`, and the faster `clef-flash`. */
export const CLOUDFLARE_DEFAULT_MODEL = "clef";

export const CLOUDFLARE_BASE_URL = "https://api.cloudflare.com/client/v4";

// Clef reads the shared question's criteria as a reason to doubt every command, and without them
// tells a script from a standard tool; measured with `scripts/eval-commands.ts`.
const CLEF_COMMAND_QUESTIONS = {
  ...COMMAND_QUESTIONS,
  runs: noul(COMMAND_QUESTIONS.runs.instructions),
};

// Cloudflare's API wraps a model's answers in `result`, and says what went wrong in `errors`.
const resultSchema = z.object({
  result: z.object({ model: z.string(), answers: z.unknown() }),
});

const failureSchema = z.object({
  errors: z.array(z.object({ message: z.string() })),
});

export interface CloudflareOptions {
  apiKey: string;
  accountId: string;
  model: string;
  baseURL: string;
  /** @default globalThis.fetch */
  fetch?: typeof globalThis.fetch;
}

// Workers AI has no System One route of its own, and Cloudflare's SDK does not know Clef's
// request or answers, so the request goes to the model's run route.
function cloudflare(options: CloudflareOptions): Ask {
  const { fetch = globalThis.fetch } = options;

  const url = `${options.baseURL.replace(/\/+$/, "")}/accounts/${encodeURIComponent(options.accountId)}/ai/run/@cf/cloudflare/${encodeURIComponent(options.model)}`;

  return async (request, signal) => {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ...request, model: options.model }),
      signal,
    });

    const body: unknown = await response.json().catch(() => undefined);

    if (!response.ok) {
      const reasons = failureSchema
        .safeParse(body)
        .data?.errors.map((error) => error.message)
        .join("; ");

      throw new Error(
        `Cloudflare Workers AI answered ${response.status}${reasons ? `: ${reasons}` : ""}`
      );
    }

    return resultSchema.parse(body).result;
  };
}

/** Judges shell commands with a Clef model on Workers AI, on the user's own token. */
export const createCloudflareCommandJudge = (
  options: CloudflareOptions
): CommandJudge =>
  createCommandJudge(cloudflare(options), CLEF_COMMAND_QUESTIONS);

/** Scores texts with a Clef model on Workers AI, on the user's own token. */
export const createCloudflareScorer = (
  options: CloudflareOptions
): SentimentScorer => createScorer(cloudflare(options));
