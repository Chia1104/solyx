import { expect, test } from "vite-plus/test";
import * as z from "zod";

import { Stance } from "@solyx/core/sentiment";

import {
  TYPESAFE_DEFAULT_MODEL,
  createTypeSafeFactReader,
} from "../src/typesafe.ts";

import { readSent } from "./fixtures/sent.ts";

const BASE_URL = "https://decisions.test";

const FACT = {
  text: "August revenue rose 53% on the year.",
  source: "Monthly revenue, 2026-08",
  quote: "Aug. 514,806 / YoY 53.3%",
};

// Strict about the question, so one added or dropped fails here.
const sentSchema = z.object({
  model: z.string(),
  state: z.strictObject({ fact: z.string(), quote: z.string() }),
  questions: z.strictObject({
    stance: z.object({
      type: z.literal("score"),
      criteria: z.array(z.string()).length(5),
    }),
  }),
});

test("asks how the fact bears on the share price and reads its five levels from bad to good", async () => {
  const requests: Request[] = [];

  const fetch = async (input: string, init?: RequestInit) => {
    requests.push(new Request(input, init));

    return Response.json({
      model: "jev-1.13.0",
      answers: {
        stance: {
          type: "score",
          score: 3.4,
          probabilities: { 0: 0.01, 1: 0.04, 2: 0.1, 3: 0.25, 4: 0.6 },
        },
      },
      usage: { input_tokens: 160, output_tokens: 10 },
    });
  };

  const reader = createTypeSafeFactReader({
    apiKey: "test-key",
    model: TYPESAFE_DEFAULT_MODEL,
    baseURL: BASE_URL,
    fetch,
  });

  expect(await reader.read(FACT)).toEqual({
    model: "jev-1.13.0",
    stance: {
      [Stance.Negative]: 0.01,
      [Stance.LeanNegative]: 0.04,
      [Stance.Neutral]: 0.1,
      [Stance.LeanPositive]: 0.25,
      [Stance.Positive]: 0.6,
    },
  });

  const sent = await readSent(requests[0], sentSchema);

  // The model reads the fact and its quote alone, never the forecast they were given for.
  expect(sent.state).toEqual({ fact: FACT.text, quote: FACT.quote });
});
