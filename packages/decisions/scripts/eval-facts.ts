import { chunk, meanBy } from "es-toolkit";

/**
 * Measures how the fact reader reads facts that are good, bad or neutral for a share price,
 * against the decisions API on a real key. Run from the repository root, for TypeSafe, Cloudflare
 * or OpenAI:
 *
 *   node --env-file=.env packages/decisions/scripts/eval-facts.ts
 *   DECISIONS_PROVIDER=cloudflare node --env-file=.env packages/decisions/scripts/eval-facts.ts
 *   DECISIONS_PROVIDER=openai node --env-file=.env packages/decisions/scripts/eval-facts.ts
 */
import { EVIDENCE_LEAN_LINE } from "@solyx/core/forecast";
import type { FactReader } from "@solyx/core/forecast";
import { stanceValue } from "@solyx/core/sentiment";

import {
  CLOUDFLARE_BASE_URL,
  CLOUDFLARE_DEFAULT_MODEL,
  createCloudflareFactReader,
} from "../src/cloudflare.ts";
import {
  OPENAI_BASE_URL,
  OPENAI_DEFAULT_MODEL,
  createOpenAIFactReader,
} from "../src/openai.ts";
import { DecisionsProvider } from "../src/provider.ts";
import {
  TYPESAFE_BASE_URL,
  TYPESAFE_DEFAULT_MODEL,
  createTypeSafeFactReader,
} from "../src/typesafe.ts";

import { FACT_SAMPLES, FactBearing } from "./fact-samples.ts";

function required(name: string): string {
  const value = process.env[name];

  if (!value) throw new Error(`Set ${name}`);

  return value;
}

function readerFor(provider: string | undefined): FactReader {
  switch (provider) {
    case DecisionsProvider.Cloudflare:
      return createCloudflareFactReader({
        apiKey: required("CLOUDFLARE_AI_API_KEY"),
        accountId: required("CLOUDFLARE_ACCOUNT_ID"),
        model: process.env.DECISIONS_MODEL ?? CLOUDFLARE_DEFAULT_MODEL,
        baseURL: CLOUDFLARE_BASE_URL,
      });
    case DecisionsProvider.OpenAI:
      return createOpenAIFactReader({
        apiKey: required("OPENAI_API_KEY"),
        model: process.env.DECISIONS_MODEL ?? OPENAI_DEFAULT_MODEL,
        baseURL: OPENAI_BASE_URL,
      });
    default:
      return createTypeSafeFactReader({
        apiKey: required("DECISIONS_API_KEY"),
        model: process.env.DECISIONS_MODEL ?? TYPESAFE_DEFAULT_MODEL,
        baseURL: TYPESAFE_BASE_URL,
      });
  }
}

const reader = readerFor(process.env.DECISIONS_PROVIDER);

const LINES = [0.1, 0.15, 0.2, EVIDENCE_LEAN_LINE, 0.3, 0.4];

const CONCURRENCY = 6;

/** Where a fact of each bearing should read: above the line, below its negative, or between them. */
const reads = (bearing: FactBearing, lean: number, line: number) => {
  if (bearing === FactBearing.Good) return lean >= line;

  return bearing === FactBearing.Bad ? lean <= -line : Math.abs(lean) < line;
};

const results: {
  fact: string;
  bearing: FactBearing;
  model: string;
  lean: number;
}[] = [];

const started = performance.now();

for (const batch of chunk(FACT_SAMPLES, CONCURRENCY)) {
  results.push(
    ...(await Promise.all(
      batch.map(async ({ fact, quote, bearing }) => {
        const { model, stance } = await reader.read({
          text: fact,
          source: "sample",
          quote,
        });

        return { fact, bearing, model, lean: stanceValue(stance) };
      })
    ))
  );
}

const seconds = (performance.now() - started) / 1000;

console.log(
  `model ${results[0]?.model}, ${results.length} facts in ${seconds.toFixed(1)}s\n`
);

for (const { fact, bearing, lean } of results) {
  console.log(
    `${bearing.padEnd(7)}  ${lean >= 0 ? "+" : ""}${lean.toFixed(2)}  ${fact.slice(0, 48)}`
  );
}

console.log(
  "\nA fact's lean runs from -1, clearly bad for the share price, to 1, clearly good."
);

for (const bearing of Object.values(FactBearing)) {
  const of = results.filter((result) => result.bearing === bearing);

  console.log(
    `${bearing}: ${of.length} facts, mean lean ${meanBy(of, ({ lean }) => lean).toFixed(2)}`
  );
}

console.log("");

for (const line of LINES) {
  const right = (bearing: FactBearing) => {
    const of = results.filter((result) => result.bearing === bearing);

    return `${of.filter(({ lean }) => reads(bearing, lean, line)).length}/${of.length} ${bearing}`;
  };

  console.log(
    `line ${line.toFixed(2)}: ${Object.values(FactBearing).map(right).join(", ")} read on their side`
  );
}
