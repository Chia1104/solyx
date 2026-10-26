/**
 * Measures how well the code judge tells a strategy's harmless code from the rest, against the
 * decisions API on a real key. Run from the repository root, for TypeSafe, Cloudflare or OpenAI:
 *
 *   node --env-file=.env packages/decisions/scripts/eval-code.ts
 *   DECISIONS_PROVIDER=cloudflare node --env-file=.env packages/decisions/scripts/eval-code.ts
 *   DECISIONS_PROVIDER=openai node --env-file=.env packages/decisions/scripts/eval-code.ts
 */
import {
  CLOUDFLARE_BASE_URL,
  CLOUDFLARE_DEFAULT_MODEL,
  createCloudflareCodeJudge,
} from "../src/cloudflare.ts";
import type { CodeJudge } from "../src/code.ts";
import {
  OPENAI_BASE_URL,
  OPENAI_DEFAULT_MODEL,
  createOpenAICodeJudge,
} from "../src/openai.ts";
import { DecisionsProvider } from "../src/provider.ts";
import {
  TYPESAFE_BASE_URL,
  TYPESAFE_DEFAULT_MODEL,
  createTypeSafeCodeJudge,
} from "../src/typesafe.ts";

import { CODE_SAMPLES } from "./code-samples.ts";
import { evaluateJudge } from "./judge-eval.ts";

function required(name: string): string {
  const value = process.env[name];

  if (!value) throw new Error(`Set ${name}`);

  return value;
}

function judgeFor(provider: string | undefined): CodeJudge {
  switch (provider) {
    case DecisionsProvider.Cloudflare:
      return createCloudflareCodeJudge({
        apiKey: required("CLOUDFLARE_AI_API_KEY"),
        accountId: required("CLOUDFLARE_ACCOUNT_ID"),
        model: process.env.DECISIONS_MODEL ?? CLOUDFLARE_DEFAULT_MODEL,
        baseURL: CLOUDFLARE_BASE_URL,
      });
    case DecisionsProvider.OpenAI:
      return createOpenAICodeJudge({
        apiKey: required("OPENAI_API_KEY"),
        model: process.env.DECISIONS_MODEL ?? OPENAI_DEFAULT_MODEL,
        baseURL: OPENAI_BASE_URL,
      });
    default:
      return createTypeSafeCodeJudge({
        apiKey: required("DECISIONS_API_KEY"),
        model: process.env.DECISIONS_MODEL ?? TYPESAFE_DEFAULT_MODEL,
        baseURL: TYPESAFE_BASE_URL,
      });
  }
}

const judge = judgeFor(process.env.DECISIONS_PROVIDER);

await evaluateJudge({
  samples: CODE_SAMPLES,
  aspects: ["files", "network", "secrets", "runs"],
  judge: (sample) =>
    judge.judge({ command: sample.command, files: sample.files }),
  name: (sample) => sample.note,
  noun: "programs",
});
