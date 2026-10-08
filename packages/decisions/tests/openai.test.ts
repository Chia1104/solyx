import { afterEach, expect, test, vi } from "vite-plus/test";
import * as z from "zod";

import { Market } from "@solyx/core/market";
import {
  Stance,
  TextKind,
  TextSpeaker,
  TextTopic,
} from "@solyx/core/sentiment";

import {
  OPENAI_DEFAULT_MODEL,
  createOpenAIClaimAuditor,
  createOpenAICommandJudge,
  createOpenAIScorer,
} from "../src/openai.ts";

const OPTIONS = {
  apiKey: "test-key",
  model: OPENAI_DEFAULT_MODEL,
  baseURL: "https://openai.test/v1",
};

const URL = `${OPTIONS.baseURL}/decisions`;

const TSMC = {
  symbol: { market: Market.TW, symbol: "2330" },
  listing: { name: "台積電", englishName: "TSMC" },
  site: "forum.test",
  url: "https://forum.test/post/1",
};

/** A noul as OpenAI answers the predicate it is sent as. */
const yes = (name: string, probability: number) => ({
  type: "predicate",
  name,
  probability,
});

const ANSWERS = [
  yes("relevance", 0.97),
  {
    type: "score",
    name: "stance",
    score: 3.1,
    confidence: 0.8,
    probabilities: [0.01, 0.04, 0.15, 0.45, 0.35].map((probability, value) => ({
      value,
      label: String(value),
      probability,
    })),
  },
  {
    type: "choice",
    name: "kind",
    choice: "opinion",
    confidence: 0.9,
    probabilities: [
      { value: "report", probability: 0.08 },
      { value: "opinion", probability: 0.9 },
      { value: "promotion", probability: 0.02 },
    ],
  },
  {
    type: "choice",
    name: "topic",
    choice: "guidance",
    confidence: 0.7,
    probabilities: [
      { value: "earnings", probability: 0.1 },
      { value: "guidance", probability: 0.7 },
      { value: "business", probability: 0.1 },
      { value: "capital", probability: 0 },
      { value: "analyst", probability: 0.05 },
      { value: "legal", probability: 0 },
      { value: "market", probability: 0.05 },
      { value: "other", probability: 0 },
    ],
  },
  {
    type: "choice",
    name: "speaker",
    choice: "investor",
    confidence: 0.8,
    probabilities: [
      { value: "company", probability: 0 },
      { value: "outlet", probability: 0.1 },
      { value: "investor", probability: 0.85 },
      { value: "reference", probability: 0.05 },
      { value: "other", probability: 0 },
    ],
  },
];

/** Answers every request the way OpenAI's Decisions API does, and records what was sent. */
function fakeOpenAI(answers: unknown[]) {
  const requests: Request[] = [];

  const fetch: typeof globalThis.fetch = async (input, init) => {
    requests.push(new Request(input, init));

    return Response.json({
      model: "gpt-6-luna",
      answers,
      usage: {
        input_tokens: 420,
        input_tokens_details: { cache_write_tokens: 0, cached_tokens: 0 },
        output_tokens: 0,
        output_tokens_details: { reasoning_tokens: 0 },
        total_tokens: 420,
      },
    });
  };

  return { fetch, requests };
}

// What each outcome means follows the question, one line each.
const noulSchema = z.object({
  type: z.literal("predicate"),
  instructions: z
    .string()
    .regex(/^[^\n]+\nTrue when: [^\n]+\nFalse when: [^\n]+$/),
});

const choiceSchema = z.object({
  type: z.literal("choice"),
  choices: z.array(z.object({ value: z.string(), description: z.string() })),
});

const sentSchema = z.object({
  model: z.string(),
  input: z.string(),
  questions: z.tuple([
    noulSchema.extend({ name: z.literal("relevance") }),
    z.object({
      name: z.literal("stance"),
      type: z.literal("score"),
      levels: z.array(z.object({ label: z.string(), description: z.string() })),
    }),
    choiceSchema.extend({ name: z.literal("kind") }),
    choiceSchema.extend({ name: z.literal("topic") }),
    choiceSchema.extend({ name: z.literal("speaker") }),
  ]),
});

afterEach(() => {
  vi.unstubAllEnvs();
});

test("asks about the listing in OpenAI's question types and maps the answers onto the scale", async () => {
  const { fetch, requests } = fakeOpenAI(ANSWERS);
  const scorer = createOpenAIScorer({ ...OPTIONS, fetch });

  const score = await scorer.score({
    ...TSMC,
    title: "法說會前瞻",
    text: "台積電這季應該會上修財測",
  });

  expect(score).toEqual({
    model: "gpt-6-luna",
    relevance: 0.97,
    stance: {
      [Stance.Negative]: 0.01,
      [Stance.LeanNegative]: 0.04,
      [Stance.Neutral]: 0.15,
      [Stance.LeanPositive]: 0.45,
      [Stance.Positive]: 0.35,
    },
    kind: { report: 0.08, opinion: 0.9, promotion: 0.02 },
    topic: {
      earnings: 0.1,
      guidance: 0.7,
      business: 0.1,
      capital: 0,
      analyst: 0.05,
      legal: 0,
      market: 0.05,
      other: 0,
    },
    speaker: {
      company: 0,
      outlet: 0.1,
      investor: 0.85,
      reference: 0.05,
      other: 0,
    },
  });

  const [request] = requests;

  expect(request.url).toBe(URL);
  expect(request.headers.get("Authorization")).toBe("Bearer test-key");

  const body = sentSchema.parse(await request.json());
  const [, stance, kind, topic, speaker] = body.questions;

  expect(body.model).toBe(OPENAI_DEFAULT_MODEL);
  expect(JSON.parse(body.input)).toEqual({
    listing: {
      market: "TW",
      code: "2330",
      name: "台積電",
      englishName: "TSMC",
    },
    title: "法說會前瞻",
    text: "台積電這季應該會上修財測",
    source: { site: "forum.test", url: "https://forum.test/post/1" },
  });
  expect(stance.levels.map((level) => level.label)).toEqual([
    "0",
    "1",
    "2",
    "3",
    "4",
  ]);
  expect(kind.choices.map((choice) => choice.value)).toEqual(
    Object.values(TextKind)
  );
  expect(topic.choices.map((choice) => choice.value)).toEqual(
    Object.values(TextTopic)
  );
  expect(speaker.choices.map((choice) => choice.value)).toEqual(
    Object.values(TextSpeaker)
  );
});

test("never takes the key, endpoint or organization from the environment", async () => {
  vi.stubEnv("OPENAI_API_KEY", "env-key");
  vi.stubEnv("OPENAI_BASE_URL", "https://env.test/v1");
  vi.stubEnv("OPENAI_ORG_ID", "org-env");
  vi.stubEnv("OPENAI_PROJECT_ID", "proj-env");

  const { fetch, requests } = fakeOpenAI(ANSWERS);
  const scorer = createOpenAIScorer({ ...OPTIONS, fetch });

  await scorer.score({ ...TSMC, text: "台積電" });

  const [request] = requests;

  expect(request.url).toBe(URL);
  expect(request.headers.get("Authorization")).toBe("Bearer test-key");
  expect(request.headers.get("OpenAI-Organization")).toBeNull();
  expect(request.headers.get("OpenAI-Project")).toBeNull();
});

test("judges a command on the model the settings name", async () => {
  const { fetch, requests } = fakeOpenAI([
    yes("changes", 0.01),
    yes("network", 0.02),
    yes("secrets", 0.03),
    yes("runs", 0.04),
    yes("privileged", 0.05),
  ]);

  const judge = createOpenAICommandJudge({
    ...OPTIONS,
    model: "gpt-6-luna-preview",
    fetch,
  });

  expect(await judge.judge({ command: "ls -la", shell: "bash" })).toEqual({
    model: "gpt-6-luna",
    changes: 0.01,
    network: 0.02,
    secrets: 0.03,
    runs: 0.04,
    privileged: 0.05,
  });

  const body = z
    .object({
      model: z.string(),
      input: z.string(),
      questions: z.array(noulSchema.extend({ name: z.string() })),
    })
    .parse(await requests[0].json());

  expect(body.model).toBe("gpt-6-luna-preview");
  expect(JSON.parse(body.input)).toEqual({ shell: "bash", command: "ls -la" });
  expect(body.questions.map((question) => question.name)).toEqual([
    "changes",
    "network",
    "secrets",
    "runs",
    "privileged",
  ]);
});

test("reads a claim's likelihood from the choice it is sent as", async () => {
  const { fetch } = fakeOpenAI([yes("supported", 0.96)]);
  const auditor = createOpenAIClaimAuditor({ ...OPTIONS, fetch });

  expect(
    await auditor.audit({
      text: "August revenue rose 53% on the year.",
      source: "Monthly revenue, 2026-08",
      quote: "Aug. 514,806 / YoY 53.3%",
    })
  ).toEqual({ model: "gpt-6-luna", supported: 0.96 });
});

test("fails when OpenAI declines a question", async () => {
  const { fetch } = fakeOpenAI([
    ANSWERS[0],
    { type: "refusal", name: "stance" },
    ANSWERS[2],
    ANSWERS[3],
  ]);

  const scorer = createOpenAIScorer({ ...OPTIONS, fetch });

  await expect(scorer.score({ ...TSMC, text: "台積電" })).rejects.toThrow(
    "OpenAI declined to answer stance"
  );
});

test("fails with OpenAI's reason and without the key", async () => {
  const scorer = createOpenAIScorer({
    ...OPTIONS,
    fetch: async () =>
      Response.json(
        {
          error: {
            message: "Incorrect API key provided.",
            type: "invalid_request_error",
            code: "invalid_api_key",
            param: null,
          },
        },
        { status: 401 }
      ),
  });

  const failure = scorer.score({ ...TSMC, text: "台積電" });

  await expect(failure).rejects.toThrow("Incorrect API key provided.");
  await expect(failure).rejects.not.toThrow(OPTIONS.apiKey);
});

test("fails on answers of another shape", async () => {
  const { fetch } = fakeOpenAI([ANSWERS[0]]);
  const scorer = createOpenAIScorer({ ...OPTIONS, fetch });

  await expect(scorer.score({ ...TSMC, text: "台積電" })).rejects.toThrow();
});
