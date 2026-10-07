import { chunk } from "es-toolkit";

/**
 * Measures how well the claim auditor tells a claim its quote states from one that outruns it,
 * against the decisions API on a real key. Run from the repository root, for TypeSafe, Cloudflare
 * or OpenAI:
 *
 *   node --env-file=.env packages/decisions/scripts/eval-claims.ts
 *   DECISIONS_PROVIDER=cloudflare node --env-file=.env packages/decisions/scripts/eval-claims.ts
 *   DECISIONS_PROVIDER=openai node --env-file=.env packages/decisions/scripts/eval-claims.ts
 */
import type { ClaimAuditor } from "@solyx/core/report";

import {
  CLOUDFLARE_BASE_URL,
  CLOUDFLARE_DEFAULT_MODEL,
  createCloudflareClaimAuditor,
} from "../src/cloudflare.ts";
import {
  OPENAI_BASE_URL,
  OPENAI_DEFAULT_MODEL,
  createOpenAIClaimAuditor,
} from "../src/openai.ts";
import { DecisionsProvider } from "../src/provider.ts";
import {
  TYPESAFE_BASE_URL,
  TYPESAFE_DEFAULT_MODEL,
  createTypeSafeClaimAuditor,
} from "../src/typesafe.ts";

import { CLAIM_SAMPLES } from "./claim-samples.ts";

function required(name: string): string {
  const value = process.env[name];

  if (!value) throw new Error(`Set ${name}`);

  return value;
}

function auditorFor(provider: string | undefined): ClaimAuditor {
  switch (provider) {
    case DecisionsProvider.Cloudflare:
      return createCloudflareClaimAuditor({
        apiKey: required("CLOUDFLARE_AI_API_KEY"),
        accountId: required("CLOUDFLARE_ACCOUNT_ID"),
        model: process.env.DECISIONS_MODEL ?? CLOUDFLARE_DEFAULT_MODEL,
        baseURL: CLOUDFLARE_BASE_URL,
      });
    case DecisionsProvider.OpenAI:
      return createOpenAIClaimAuditor({
        apiKey: required("OPENAI_API_KEY"),
        model: process.env.DECISIONS_MODEL ?? OPENAI_DEFAULT_MODEL,
        baseURL: OPENAI_BASE_URL,
      });
    default:
      return createTypeSafeClaimAuditor({
        apiKey: required("DECISIONS_API_KEY"),
        model: process.env.DECISIONS_MODEL ?? TYPESAFE_DEFAULT_MODEL,
        baseURL: TYPESAFE_BASE_URL,
      });
  }
}

const auditor = auditorFor(process.env.DECISIONS_PROVIDER);

const THRESHOLDS = [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8];

const CONCURRENCY = 6;

const results: {
  claim: string;
  supported: boolean;
  note: string;
  model: string;
  likelihood: number;
}[] = [];

const started = performance.now();

for (const batch of chunk(CLAIM_SAMPLES, CONCURRENCY)) {
  results.push(
    ...(await Promise.all(
      batch.map(async (sample) => {
        const support = await auditor.audit({
          text: sample.claim,
          source: "sample",
          quote: sample.quote,
        });

        return {
          ...sample,
          model: support.model,
          likelihood: support.supported,
        };
      })
    ))
  );
}

const seconds = (performance.now() - started) / 1000;

console.log(
  `model ${results[0]?.model}, ${results.length} claims in ${seconds.toFixed(1)}s\n`
);

for (const { claim, supported, note, likelihood } of results) {
  console.log(
    `${supported ? "held  " : "outrun"}  ${likelihood.toFixed(2)}  ${claim.slice(0, 44)}  (${note})`
  );
}

const heldTotal = results.filter((result) => result.supported).length;

const outrunTotal = results.length - heldTotal;

console.log(
  `\nA claim reads as borne out at or above the threshold.\n${heldTotal} held, ${outrunTotal} outrun.\n`
);

for (const threshold of THRESHOLDS) {
  const passed = results.filter((result) => result.likelihood >= threshold);
  const wrong = passed.filter((result) => !result.supported);

  console.log(
    `threshold ${threshold.toFixed(2)}: ${passed.length - wrong.length}/${heldTotal} held read as borne out, ${wrong.length}/${outrunTotal} outrun read as borne out`
  );
}
