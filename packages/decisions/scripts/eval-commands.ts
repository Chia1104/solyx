/**
 * Measures how well the command judge tells harmless shell commands from the rest, against the
 * decisions API on a real key. Run from the repository root, for TypeSafe, Cloudflare or OpenAI:
 *
 *   node --env-file=.env packages/decisions/scripts/eval-commands.ts
 *   DECISIONS_PROVIDER=cloudflare node --env-file=.env packages/decisions/scripts/eval-commands.ts
 *   DECISIONS_PROVIDER=openai node --env-file=.env packages/decisions/scripts/eval-commands.ts
 */
import {
  CLOUDFLARE_BASE_URL,
  CLOUDFLARE_DEFAULT_MODEL,
  createCloudflareCommandJudge,
} from "../src/cloudflare.ts";
import type { CommandJudge } from "../src/command.ts";
import {
  OPENAI_BASE_URL,
  OPENAI_DEFAULT_MODEL,
  createOpenAICommandJudge,
} from "../src/openai.ts";
import { DecisionsProvider } from "../src/provider.ts";
import {
  TYPESAFE_BASE_URL,
  TYPESAFE_DEFAULT_MODEL,
  createTypeSafeCommandJudge,
} from "../src/typesafe.ts";

import { COMMAND_SAMPLES } from "./command-samples.ts";
import { evaluateJudge } from "./judge-eval.ts";

function required(name: string): string {
  const value = process.env[name];

  if (!value) throw new Error(`Set ${name}`);

  return value;
}

function judgeFor(provider: string | undefined): CommandJudge {
  switch (provider) {
    case DecisionsProvider.Cloudflare:
      return createCloudflareCommandJudge({
        apiKey: required("CLOUDFLARE_AI_API_KEY"),
        accountId: required("CLOUDFLARE_ACCOUNT_ID"),
        model: process.env.DECISIONS_MODEL ?? CLOUDFLARE_DEFAULT_MODEL,
        baseURL: CLOUDFLARE_BASE_URL,
      });
    case DecisionsProvider.OpenAI:
      return createOpenAICommandJudge({
        apiKey: required("OPENAI_API_KEY"),
        model: process.env.DECISIONS_MODEL ?? OPENAI_DEFAULT_MODEL,
        baseURL: OPENAI_BASE_URL,
      });
    default:
      return createTypeSafeCommandJudge({
        apiKey: required("DECISIONS_API_KEY"),
        model: process.env.DECISIONS_MODEL ?? TYPESAFE_DEFAULT_MODEL,
        baseURL: TYPESAFE_BASE_URL,
      });
  }
}

const judge = judgeFor(process.env.DECISIONS_PROVIDER);

await evaluateJudge({
  samples: COMMAND_SAMPLES,
  aspects: ["changes", "network", "secrets", "runs", "privileged"],
  judge: (sample) =>
    judge.judge({ command: sample.command, shell: sample.shell ?? "bash" }),
  name: (sample) => sample.command.replace(/\s+/g, " ").slice(0, 70),
  noun: "commands",
});
