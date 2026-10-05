import { expect, test } from "vite-plus/test";
import * as z from "zod";

import { Market } from "@solyx/core/market";
import { Stance, TextKind, TextTopic } from "@solyx/core/sentiment";

import {
  CLOUDFLARE_DEFAULT_MODEL,
  createCloudflareCommandJudge,
  createCloudflareScorer,
} from "../src/cloudflare.ts";

const OPTIONS = {
  apiKey: "test-token",
  accountId: "account-1",
  model: CLOUDFLARE_DEFAULT_MODEL,
  baseURL: "https://cloudflare.test/client/v4",
};

const URL = `${OPTIONS.baseURL}/accounts/account-1/ai/run/@cf/cloudflare/clef`;

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

const COMMAND_ANSWERS = {
  changes: { type: "noul", noul: 0.01 },
  network: { type: "noul", noul: 0.02 },
  secrets: { type: "noul", noul: 0.03 },
  runs: { type: "noul", noul: 0.04 },
  privileged: { type: "noul", noul: 0.05 },
};

/** Answers every request the way Cloudflare's API wraps a model's answers, and records what was sent. */
function fakeCloudflare(
  answers: Partial<typeof ANSWERS> | typeof COMMAND_ANSWERS
) {
  const requests: Request[] = [];

  const fetch: typeof globalThis.fetch = async (input, init) => {
    requests.push(new Request(input, init));

    return Response.json({
      result: {
        model: "clef",
        answers,
        usage: { input_tokens: 420, output_tokens: 0 },
      },
      success: true,
      errors: [],
      messages: [],
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

const commandSentSchema = z.object({
  model: z.string(),
  state: z.object({ shell: z.string(), command: z.string() }),
  questions: z.strictObject({
    changes: z.object({ type: z.literal("noul") }),
    network: z.object({ type: z.literal("noul") }),
    secrets: z.object({ type: z.literal("noul") }),
    runs: z.object({ type: z.literal("noul") }),
    privileged: z.object({ type: z.literal("noul") }),
  }),
});

test("asks the account's model about the listing and maps the answers onto the scale", async () => {
  const { fetch, requests } = fakeCloudflare(ANSWERS);
  const scorer = createCloudflareScorer({ ...OPTIONS, fetch });

  const score = await scorer.score({
    ...TSMC,
    title: "法說會前瞻",
    text: "台積電這季應該會上修財測",
  });

  expect(score).toEqual({
    model: "clef",
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

  expect(request.url).toBe(URL);
  expect(request.headers.get("Authorization")).toBe("Bearer test-token");

  const body = sentSchema.parse(await request.json());

  expect(body.model).toBe(CLOUDFLARE_DEFAULT_MODEL);
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

test("cuts long texts to what a score covers", async () => {
  const { fetch, requests } = fakeCloudflare(ANSWERS);
  const scorer = createCloudflareScorer({ ...OPTIONS, fetch });

  await scorer.score({ ...TSMC, listing: null, text: "漲".repeat(20_000) });

  const { state } = sentSchema.parse(await requests[0].json());

  expect(state.text).toHaveLength(12_000);
  expect(state.listing).toEqual({
    market: "TW",
    code: "2330",
    name: null,
    englishName: null,
  });
  expect(state.title).toBeNull();
});

test("judges a command on the model the settings name", async () => {
  const { fetch, requests } = fakeCloudflare(COMMAND_ANSWERS);

  const judge = createCloudflareCommandJudge({
    ...OPTIONS,
    model: "clef-flash",
    fetch,
  });

  expect(await judge.judge({ command: "ls -la", shell: "bash" })).toEqual({
    model: "clef",
    changes: 0.01,
    network: 0.02,
    secrets: 0.03,
    runs: 0.04,
    privileged: 0.05,
  });

  const [request] = requests;

  expect(request.url).toBe(`${URL}-flash`);

  const body = commandSentSchema.parse(await request.json());

  expect(body.model).toBe("clef-flash");
  expect(body.state).toEqual({ shell: "bash", command: "ls -la" });
});

test("fails with Cloudflare's reason and without the token", async () => {
  const scorer = createCloudflareScorer({
    ...OPTIONS,
    fetch: async () =>
      Response.json(
        {
          result: null,
          success: false,
          errors: [{ code: 10000, message: "Authentication error" }],
        },
        { status: 401 }
      ),
  });

  const failure = scorer.score({ ...TSMC, text: "台積電" });

  await expect(failure).rejects.toThrow(
    "Cloudflare Workers AI answered 401: Authentication error"
  );
  await expect(failure).rejects.not.toThrow(OPTIONS.apiKey);
});

test("fails on answers of another shape", async () => {
  const { fetch } = fakeCloudflare({ relevance: { type: "noul", noul: 1 } });
  const scorer = createCloudflareScorer({ ...OPTIONS, fetch });

  await expect(scorer.score({ ...TSMC, text: "台積電" })).rejects.toThrow();
});
