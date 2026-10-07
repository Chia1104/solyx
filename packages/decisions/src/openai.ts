import type { Question } from "@typesafe-ai/sdk";
import OpenAI from "openai";
import type {
  Decision,
  DecisionCreateParams,
} from "openai/resources/decisions";
import * as z from "zod";

import type { ClaimAuditor } from "@solyx/core/report";
import type { SentimentScorer } from "@solyx/core/sentiment";

import type { CommandJudge } from "./command.ts";
import {
  createClaimAuditor,
  createCommandJudge,
  createScorer,
} from "./system-one.ts";
import type { Ask } from "./system-one.ts";

/** OpenAI serves Luna, its only decisions model, under one unversioned id. */
export const OPENAI_DEFAULT_MODEL = "gpt-6-luna";

export const OPENAI_BASE_URL = "https://api.openai.com/v1";

export interface OpenAIOptions {
  apiKey: string;
  model: string;
  baseURL: string;
  /** @default globalThis.fetch */
  fetch?: typeof globalThis.fetch;
}

// The shared questions are worded in text, the only wording OpenAI's questions take.
const instructionsSchema = z.string();

const criterionSchema = z.string().optional();

// A noul goes as a predicate whose instructions end with what each outcome means: Luna reads that
// better than a choice between `true` and `false`, measured with both eval scripts. A score's
// levels are labelled by their index, as System One numbers them.
function question(
  name: string,
  asked: Question
): DecisionCreateParams["questions"][number] {
  const instructions = instructionsSchema.parse(asked.instructions);

  switch (asked.type) {
    case "noul": {
      const yes = criterionSchema.parse(asked.criteria?.true);
      const no = criterionSchema.parse(asked.criteria?.false);

      return {
        type: "predicate",
        name,
        instructions: [
          instructions,
          yes === undefined ? undefined : `True when: ${yes}`,
          no === undefined ? undefined : `False when: ${no}`,
        ]
          .filter((line) => line !== undefined)
          .join("\n"),
      };
    }

    case "score":
      return {
        type: "score",
        name,
        instructions,
        levels: asked.criteria.map((criterion, index) => ({
          label: String(index),
          description: criterionSchema.parse(criterion),
        })),
      };
    case "choice":
      return {
        type: "choice",
        name,
        instructions,
        choices: Object.entries(asked.criteria).map(([value, criterion]) => ({
          value,
          description: criterionSchema.parse(criterion),
        })),
      };
  }
}

/** One answer in System One's shape, which `system-one.ts` reads. */
function read(given: Decision["answers"][number]) {
  if (given.type === "refusal") {
    throw new Error(`OpenAI declined to answer ${given.name ?? "a question"}`);
  }

  if (given.type === "predicate") return { noul: given.probability };

  return {
    probabilities: Object.fromEntries(
      given.probabilities.map(({ value, probability }) => [
        String(value),
        probability,
      ])
    ),
  };
}

function openAI(options: OpenAIOptions): Ask {
  // The key, endpoint, organization and project are passed so none falls back to an OPENAI_*
  // environment variable, and logging stays off, since debug logging would print texts.
  const client = new OpenAI({
    apiKey: options.apiKey,
    adminAPIKey: null,
    organization: null,
    project: null,
    webhookSecret: null,
    baseURL: options.baseURL,
    // Failures reach the caller as errors.
    logLevel: "off",
    fetch: options.fetch,
  });

  return async ({ state, questions }, signal) => {
    const decision = await client.decisions.create(
      {
        model: options.model,
        // The questions name the state's entries in backticks, as its keys.
        input: JSON.stringify(state),
        questions: Object.entries(questions).map(([name, asked]) =>
          question(name, asked)
        ),
      },
      { signal }
    );

    return {
      model: decision.model,
      answers: Object.fromEntries(
        decision.answers.map((given) => [given.name, read(given)])
      ),
    };
  };
}

/** Judges shell commands with OpenAI's decisions model, on the user's own key. */
export const createOpenAICommandJudge = (
  options: OpenAIOptions
): CommandJudge => createCommandJudge(openAI(options));

/** Scores texts with OpenAI's decisions model, on the user's own key. */
export const createOpenAIScorer = (options: OpenAIOptions): SentimentScorer =>
  createScorer(openAI(options));

/** Reads claims against their quotes with OpenAI's decisions model, on the user's own key. */
export const createOpenAIClaimAuditor = (
  options: OpenAIOptions
): ClaimAuditor => createClaimAuditor(openAI(options));
