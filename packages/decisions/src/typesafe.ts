import { TypeSafeClient } from "@typesafe-ai/sdk";
import type { Fetch } from "@typesafe-ai/sdk";

import type { SentimentScorer } from "@solyx/core/sentiment";

import type { CommandJudge } from "./command.ts";
import { createCommandJudge, createScorer } from "./system-one.ts";
import type { Ask } from "./system-one.ts";

/** Pinned rather than `jev-latest`, so the questions keep the behaviour they were measured against. */
export const TYPESAFE_DEFAULT_MODEL = "jev-1.13.0";

export const TYPESAFE_BASE_URL = "https://api.typesafe.ai";

export interface TypeSafeOptions {
  apiKey: string;
  model: string;
  baseURL: string;
  /** @default globalThis.fetch */
  fetch?: Fetch;
}

function typeSafe(options: TypeSafeOptions): Ask {
  // Each setting is passed so none falls back to a TYPESAFE_* environment variable: the key and
  // endpoint come only from the user's settings, and debug logging would print texts.
  const client = new TypeSafeClient({
    apiKey: options.apiKey,
    baseURL: options.baseURL,
    defaultModel: options.model,
    // Failures reach the caller as errors.
    logLevel: "off",
    fetch: options.fetch,
  });

  return (request, signal) =>
    client.systemOne({ ...request, model: options.model }, { signal });
}

/** Judges shell commands with a TypeSafe System One model, such as Jev, on the user's own key. */
export const createTypeSafeCommandJudge = (
  options: TypeSafeOptions
): CommandJudge => createCommandJudge(typeSafe(options));

/** Scores texts with a TypeSafe System One model, such as Jev, on the user's own key. */
export const createTypeSafeScorer = (
  options: TypeSafeOptions
): SentimentScorer => createScorer(typeSafe(options));
