import * as z from "zod";

import { symbolRefSchema } from "./market.ts";
import type { SymbolRef } from "./market.ts";
import { holdsSecret } from "./memory.ts";

/** Where a report expects the shares to go over quarters, not sessions. */
export const ReportStance = {
  Bullish: "bullish",
  Neutral: "neutral",
  Bearish: "bearish",
} as const;

export type ReportStance = (typeof ReportStance)[keyof typeof ReportStance];

/** A report's prose, each part revised on its own. */
export const ReportSection = {
  Business: "business",
  Financials: "financials",
  Valuation: "valuation",
  Catalysts: "catalysts",
  Risks: "risks",
} as const;

export type ReportSection = (typeof ReportSection)[keyof typeof ReportSection];

/** Text the agent wrote and research keeps; it refuses what looks like a key, token or ID number. */
export function proseSchema(max: number) {
  return z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine(
      (text) => !holdsSecret(text),
      "Research never holds a key, token, password or ID number"
    );
}

/** Something a report or forecast asserts, with what it rests on. */
export const claimSchema = z.object({
  text: proseSchema(300),
  /** Where it comes from: a page's address, or a name such as a filing's. */
  source: proseSchema(300),
  /** The source's own words or figures the claim rests on. */
  quote: proseSchema(500),
});

export type Claim = z.infer<typeof claimSchema>;

const valuationSchema = z.object({
  /** The range of prices the report finds fair. */
  low: z.number().positive(),
  high: z.number().positive(),
  /** What the range is measured by, such as a multiple of earnings. */
  basis: proseSchema(300),
});

const reportEventSchema = z.object({
  /** Exchange-local date, `YYYY-MM-DD`. */
  date: z.iso.date(),
  label: proseSchema(100),
});

/**
 * What a revision changes. A part left out stays as the last revision had it, so a report is
 * revised where it went stale rather than written again.
 */
export const reportDraftSchema = z.object({
  symbol: symbolRefSchema,
  stance: z.enum(ReportStance).optional(),
  /** The argument for the stance, in a few sentences. */
  thesis: proseSchema(600).optional(),
  /** What carries the thesis. */
  drivers: z.array(claimSchema).max(8).optional(),
  risks: z.array(claimSchema).max(8).optional(),
  /** What would show the thesis wrong, each stated as something that happens. */
  falsifiers: z.array(proseSchema(300)).max(6).optional(),
  /** `null` drops the range. */
  valuation: valuationSchema.nullable().optional(),
  /** Dates ahead that could move the shares, such as results or a dividend. */
  events: z.array(reportEventSchema).max(8).optional(),
  sections: z
    .partialRecord(z.enum(ReportSection), proseSchema(6_000))
    .optional(),
});

export type ReportDraft = z.infer<typeof reportDraftSchema>;

/** What the agent holds of a listing over quarters; every revision is kept. */
export interface Report {
  symbol: SymbolRef;
  /** Counts from 1. */
  revision: number;
  /** Epoch ms. */
  revisedAt: number;
  stance: ReportStance;
  thesis: string;
  drivers: Claim[];
  risks: Claim[];
  falsifiers: string[];
  valuation: z.infer<typeof valuationSchema> | null;
  events: z.infer<typeof reportEventSchema>[];
  /** Each part with when it was last written, in epoch ms, which tells how old it is. */
  sections: Partial<Record<ReportSection, { text: string; revisedAt: number }>>;
}

export const ReportViolationCode = {
  MissingStance: "missing-stance",
  MissingThesis: "missing-thesis",
  ValuationInverted: "valuation-inverted",
} as const;

export type ReportViolationCode =
  (typeof ReportViolationCode)[keyof typeof ReportViolationCode];

/** Carries the data behind a rejection, not text; presenters word it. */
export type ReportViolation =
  | { code: typeof ReportViolationCode.MissingStance }
  | { code: typeof ReportViolationCode.MissingThesis }
  | {
      code: typeof ReportViolationCode.ValuationInverted;
      low: number;
      high: number;
    };

export type Revision =
  | { ok: true; report: Report }
  | { ok: false; violations: ReportViolation[] };

/**
 * The revision `draft` makes of `previous`, written at `at`; a listing's first must give a stance
 * and a thesis, since nothing earlier holds them.
 */
export function reviseReport(
  previous: Report | null,
  draft: ReportDraft,
  at: number
): Revision {
  const stance = draft.stance ?? previous?.stance;
  const thesis = draft.thesis ?? previous?.thesis;

  const valuation =
    draft.valuation === undefined
      ? (previous?.valuation ?? null)
      : draft.valuation;

  const violations: ReportViolation[] = [];

  if (stance === undefined) {
    violations.push({ code: ReportViolationCode.MissingStance });
  }

  if (thesis === undefined) {
    violations.push({ code: ReportViolationCode.MissingThesis });
  }

  if (valuation && valuation.low > valuation.high) {
    violations.push({
      code: ReportViolationCode.ValuationInverted,
      low: valuation.low,
      high: valuation.high,
    });
  }

  if (stance === undefined || thesis === undefined || violations.length > 0) {
    return { ok: false, violations };
  }

  const sections = { ...previous?.sections };

  for (const section of Object.values(ReportSection)) {
    const text = draft.sections?.[section];

    if (text !== undefined) sections[section] = { text, revisedAt: at };
  }

  return {
    ok: true,
    report: {
      symbol: draft.symbol,
      revision: (previous?.revision ?? 0) + 1,
      revisedAt: at,
      stance,
      thesis,
      drivers: draft.drivers ?? previous?.drivers ?? [],
      risks: draft.risks ?? previous?.risks ?? [],
      falsifiers: draft.falsifiers ?? previous?.falsifiers ?? [],
      valuation,
      events: draft.events ?? previous?.events ?? [],
      sections,
    },
  };
}
