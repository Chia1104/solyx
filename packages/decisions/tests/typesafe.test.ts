import { afterEach, expect, test, vi } from "vite-plus/test";
import * as z from "zod";

import { Market } from "@solyx/core/market";
import { Stance, TextKind, TextTopic } from "@solyx/core/sentiment";

import {
  TYPESAFE_DEFAULT_MODEL,
  createTypeSafeScorer,
} from "../src/typesafe.ts";

const BASE_URL = "https://decisions.test";

const TSMC = {
  symbol: { market: Market.TW, symbol: "2330" },
  listing: { name: "台積電", englishName: "TSMC" },
};

const ANSWERS = {
  relevance: { type: "noul", noul: 0.97 },
  stance: {
    type: "score",
    score: 3.1,
    confidence: 0.8,
    legend: {},
    probabilities: { 0: 0.01, 1: 0.04, 2: 0.15, 3: 0.45, 4: 0.35 },
  },
  kind: {
    type: "choice",
    choice: "opinion",
    confidence: 0.9,
    probabilities: { report: 0.08, opinion: 0.9, promotion: 0.02 },
  },
  topic: {
    type: "choice",
    choice: "guidance",
    confidence: 0.7,
    probabilities: {
      earnings: 0.1,
      guidance: 0.7,
      business: 0.1,
      capital: 0,
      analyst: 0.05,
      legal: 0,
      market: 0.05,
      other: 0,
    },
  },
};

/** Answers every request with the canned answers and records what was sent. */
function fakeTypeSafe() {
  const requests: Request[] = [];

  const fetch = async (input: string, init?: RequestInit) => {
    requests.push(new Request(input, init));

    return Response.json({
      model: "jev-1.13.0",
      answers: ANSWERS,
      usage: { input_tokens: 420, output_tokens: 40 },
    });
  };

  return { fetch, requests };
}

// Strict about the questions, so a question added or dropped fails here.
const sentSchema = z.object({
  model: z.string(),
  state: z.object({
    listing: z.object({
      market: z.string(),
      code: z.string(),
      name: z.string().nullable(),
      englishName: z.string().nullable(),
    }),
    title: z.string().nullable(),
    text: z.string(),
  }),
  questions: z.strictObject({
    relevance: z.object({ type: z.literal("noul") }),
    stance: z.object({
      type: z.literal("score"),
      criteria: z.array(z.string()),
    }),
    kind: z.object({
      type: z.literal("choice"),
      criteria: z.record(z.string(), z.string()),
    }),
    topic: z.object({
      type: z.literal("choice"),
      criteria: z.record(z.string(), z.string()),
    }),
  }),
});

/** The body the scorer sent. */
async function sent(request: Request) {
  return sentSchema.parse(await request.json());
}

afterEach(() => {
  vi.unstubAllEnvs();
});

test("asks about the listing and maps the answers onto the scale", async () => {
  const { fetch, requests } = fakeTypeSafe();

  const scorer = createTypeSafeScorer({
    apiKey: "test-key",
    model: TYPESAFE_DEFAULT_MODEL,
    baseURL: BASE_URL,
    fetch,
  });

  const score = await scorer.score({
    ...TSMC,
    title: "法說會前瞻",
    text: "台積電這季應該會上修財測",
  });

  expect(score).toEqual({
    model: "jev-1.13.0",
    relevance: 0.97,
    stance: {
      [Stance.Negative]: 0.01,
      [Stance.LeanNegative]: 0.04,
      [Stance.Neutral]: 0.15,
      [Stance.LeanPositive]: 0.45,
      [Stance.Positive]: 0.35,
    },
    kind: ANSWERS.kind.probabilities,
    topic: ANSWERS.topic.probabilities,
  });

  const [request] = requests;

  expect(request.url).toBe(`${BASE_URL}/v1/systemone`);
  expect(request.headers.get("Authorization")).toBe("Bearer test-key");

  const body = await sent(request);

  expect(body.model).toBe(TYPESAFE_DEFAULT_MODEL);
  expect(body.state).toEqual({
    listing: {
      market: "TW",
      code: "2330",
      name: "台積電",
      englishName: "TSMC",
    },
    title: "法說會前瞻",
    text: "台積電這季應該會上修財測",
  });
  expect(Object.keys(body.questions.kind.criteria)).toEqual(
    Object.values(TextKind)
  );
  expect(Object.keys(body.questions.topic.criteria)).toEqual(
    Object.values(TextTopic)
  );
  expect(body.questions.stance.criteria).toHaveLength(
    Object.values(Stance).length
  );
});

test("never takes the key, endpoint or model from the environment", async () => {
  vi.stubEnv("TYPESAFE_API_KEY", "env-key");
  vi.stubEnv("TYPESAFE_BASE_URL", "https://env.test");
  vi.stubEnv("TYPESAFE_DEFAULT_MODEL", "env-model");

  const { fetch, requests } = fakeTypeSafe();

  const scorer = createTypeSafeScorer({
    apiKey: "test-key",
    model: "jev-preview",
    baseURL: BASE_URL,
    fetch,
  });

  await scorer.score({ ...TSMC, text: "台積電" });

  const [request] = requests;

  expect(request.url).toBe(`${BASE_URL}/v1/systemone`);
  expect(request.headers.get("Authorization")).toBe("Bearer test-key");
  expect((await sent(request)).model).toBe("jev-preview");
});

test("cuts long texts to what the model reads", async () => {
  const { fetch, requests } = fakeTypeSafe();

  const scorer = createTypeSafeScorer({
    apiKey: "test-key",
    model: TYPESAFE_DEFAULT_MODEL,
    baseURL: BASE_URL,
    fetch,
  });

  await scorer.score({ ...TSMC, listing: null, text: "漲".repeat(20_000) });

  const { state } = await sent(requests[0]);

  expect(state.text).toHaveLength(12_000);
  expect(state.listing).toEqual({
    market: "TW",
    code: "2330",
    name: null,
    englishName: null,
  });
  expect(state.title).toBeNull();
});
