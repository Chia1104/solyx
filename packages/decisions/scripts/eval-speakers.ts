/**
 * Measures how well the scorer tells who wrote a text, against the decisions API on a real key,
 * and what a story's speaker comes to once an unsure reading falls back on its channel. Run from
 * the repository root, for TypeSafe, Cloudflare or OpenAI:
 *
 *   node --env-file=.env packages/decisions/scripts/eval-speakers.ts
 *   DECISIONS_PROVIDER=cloudflare node --env-file=.env packages/decisions/scripts/eval-speakers.ts
 *   DECISIONS_PROVIDER=openai node --env-file=.env packages/decisions/scripts/eval-speakers.ts
 */
import { chunk, maxBy } from "es-toolkit";

import { CHANNEL_SPEAKER, SPEAKER_CONFIDENCE } from "@solyx/core/news";
import { TextSpeaker } from "@solyx/core/sentiment";
import type { SentimentScorer } from "@solyx/core/sentiment";

import {
  CLOUDFLARE_BASE_URL,
  CLOUDFLARE_DEFAULT_MODEL,
  createCloudflareScorer,
} from "../src/cloudflare.ts";
import {
  OPENAI_BASE_URL,
  OPENAI_DEFAULT_MODEL,
  createOpenAIScorer,
} from "../src/openai.ts";
import { DecisionsProvider } from "../src/provider.ts";
import {
  TYPESAFE_BASE_URL,
  TYPESAFE_DEFAULT_MODEL,
  createTypeSafeScorer,
} from "../src/typesafe.ts";

import { SPEAKER_SAMPLES } from "./speaker-samples.ts";

function required(name: string): string {
  const value = process.env[name];

  if (!value) throw new Error(`Set ${name}`);

  return value;
}

function scorerFor(provider: string | undefined): SentimentScorer {
  switch (provider) {
    case DecisionsProvider.Cloudflare:
      return createCloudflareScorer({
        apiKey: required("CLOUDFLARE_AI_API_KEY"),
        accountId: required("CLOUDFLARE_ACCOUNT_ID"),
        model: process.env.DECISIONS_MODEL ?? CLOUDFLARE_DEFAULT_MODEL,
        baseURL: CLOUDFLARE_BASE_URL,
      });
    case DecisionsProvider.OpenAI:
      return createOpenAIScorer({
        apiKey: required("OPENAI_API_KEY"),
        model: process.env.DECISIONS_MODEL ?? OPENAI_DEFAULT_MODEL,
        baseURL: OPENAI_BASE_URL,
      });
    default:
      return createTypeSafeScorer({
        apiKey: required("DECISIONS_API_KEY"),
        model: process.env.DECISIONS_MODEL ?? TYPESAFE_DEFAULT_MODEL,
        baseURL: TYPESAFE_BASE_URL,
      });
  }
}

const scorer = scorerFor(process.env.DECISIONS_PROVIDER);

const FLOORS = [0, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7];

const CONCURRENCY = 6;

const SPEAKERS = Object.values(TextSpeaker);

const EVEN = 1 / SPEAKERS.length;

const results: {
  title: string;
  note: string;
  speaker: TextSpeaker;
  channelSpeaker: TextSpeaker;
  likeliest: TextSpeaker;
  sureness: number;
  model: string;
}[] = [];

const started = performance.now();

for (const batch of chunk(SPEAKER_SAMPLES, CONCURRENCY)) {
  results.push(
    ...(await Promise.all(
      batch.map(async (sample) => {
        const score = await scorer.score(sample.input);

        const likeliest =
          maxBy(SPEAKERS, (speaker) => score.speaker[speaker]) ??
          TextSpeaker.Other;

        return {
          title: sample.input.title ?? sample.input.text,
          note: sample.note,
          speaker: sample.speaker,
          channelSpeaker: CHANNEL_SPEAKER[sample.channel],
          likeliest,
          sureness: (score.speaker[likeliest] - EVEN) / (1 - EVEN),
          model: score.model,
        };
      })
    ))
  );
}

const seconds = (performance.now() - started) / 1000;

console.log(
  `model ${results[0]?.model}, ${results.length} texts in ${seconds.toFixed(1)}s\n`
);

for (const { title, note, speaker, likeliest, sureness } of results) {
  console.log(
    `${likeliest === speaker ? "right" : "WRONG"}  ${speaker.padEnd(9)} read ${likeliest.padEnd(9)} ${sureness.toFixed(2)}  ${title.slice(0, 36)}  (${note})`
  );
}

const channelRight = results.filter(
  (result) => result.channelSpeaker === result.speaker
).length;

console.log(
  `\nThe channel alone names ${channelRight}/${results.length} speakers. Below the floor, a story's channel names its speaker; the app's floor is ${SPEAKER_CONFIDENCE}.\n`
);

for (const floor of FLOORS) {
  const sure = results.filter((result) => result.sureness >= floor);

  const sureRight = sure.filter(
    (result) => result.likeliest === result.speaker
  );

  const right = results.filter((result) =>
    result.sureness >= floor
      ? result.likeliest === result.speaker
      : result.channelSpeaker === result.speaker
  ).length;

  console.log(
    `floor ${floor.toFixed(2)}: ${sure.length} sure, ${sureRight.length} of them right; ${right}/${results.length} right in all`
  );
}
