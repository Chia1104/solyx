import { expect, test } from "vite-plus/test";
import * as z from "zod";

import {
  TYPESAFE_DEFAULT_MODEL,
  createTypeSafeClaimAuditor,
} from "../src/typesafe.ts";

const BASE_URL = "https://decisions.test";

const CLAIM = {
  text: "August revenue rose 53% on the year.",
  source: "Monthly revenue, 2026-08",
  quote: "Aug. 514,806 / YoY 53.3%",
};

// Strict about the question, so one added or dropped fails here.
const sentSchema = z.object({
  model: z.string(),
  state: z.strictObject({ claim: z.string(), quote: z.string() }),
  questions: z.strictObject({
    supported: z.object({ type: z.literal("noul") }),
  }),
});

test("asks whether the quote states the claim and reads the likelihood", async () => {
  const requests: Request[] = [];

  const fetch = async (input: string, init?: RequestInit) => {
    requests.push(new Request(input, init));

    return Response.json({
      model: "jev-1.13.0",
      answers: { supported: { type: "noul", noul: 0.96 } },
      usage: { input_tokens: 120, output_tokens: 10 },
    });
  };

  const auditor = createTypeSafeClaimAuditor({
    apiKey: "test-key",
    model: TYPESAFE_DEFAULT_MODEL,
    baseURL: BASE_URL,
    fetch,
  });

  expect(await auditor.audit(CLAIM)).toEqual({
    model: "jev-1.13.0",
    supported: 0.96,
  });

  const sent = sentSchema.parse(await requests[0].json());

  // The model reads the claim and its quote alone; where the quote came from is not its to judge.
  expect(sent.state).toEqual({ claim: CLAIM.text, quote: CLAIM.quote });
});
