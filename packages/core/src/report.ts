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

/** A fact a report or forecast rests on, with the source's own words for it. */
export const claimSchema = z.object({
  /** The fact, saying no more than its quote does. */
  text: proseSchema(300),
  /** Where it comes from: a page's address, or a name such as a filing's. */
  source: proseSchema(300),
  /** The source's own words or figures the claim rests on, in full: long enough for every row a fact sums up. */
  quote: proseSchema(1_200),
});

export type Claim = z.infer<typeof claimSchema>;

/** A driver or a risk: what the agent makes of a fact, and the fact it rests on. */
export const argumentSchema = claimSchema.extend({
  /** What the fact means for the thesis: the agent's own reading, which no quote has to state. */
  point: proseSchema(300),
});

export type Argument = z.infer<typeof argumentSchema>;

/** How far a claim's quote bears it out, as a decisions model reads the two. */
export interface ClaimSupport {
  model: string;
  /** From 0 to 1: how likely the quote states what the claim asserts. */
  supported: number;
}

/**
 * Below this a quote is read as saying less than its claim, and the claim is refused. It rests on
 * `eval-claims` in `@solyx/decisions`: measure again after changing the question or a default model.
 */
export const CLAIM_SUPPORT_LINE = 0.6;

/** The claims whose quotes were read as saying less than they assert. */
export function unsupportedClaims(
  claims: readonly Claim[],
  support: (claim: Claim) => ClaimSupport | null
): { claim: string; supported: number }[] {
  return claims.flatMap((claim) => {
    const reading = support(claim);

    return reading && reading.supported < CLAIM_SUPPORT_LINE
      ? [{ claim: claim.text, supported: reading.supported }]
      : [];
  });
}

/** A claim as kept, with the reading its fact was given; `null` when no decisions model read it. */
export type Audited<Kept extends Claim> = Kept & {
  support: ClaimSupport | null;
};

export type AuditedClaim = Audited<Claim>;

/**
 * Reads whether a claim's quote states its fact, never an argument's point. It sees the quote the agent gave and never the source,
 * so it catches a claim that says more than its quote, not a quote that was made up. One
 * implementation per decisions model (`@solyx/decisions/*`); it runs only in the main process.
 */
export interface ClaimAuditor {
  audit(
    claim: Claim,
    options?: { signal?: AbortSignal }
  ): Promise<ClaimSupport>;
}

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
  drivers: z.array(argumentSchema).max(8).optional(),
  risks: z.array(argumentSchema).max(8).optional(),
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
  /** The last day, `YYYY-MM-DD`, of the newest quarter that was public when it was revised; `null` when none was known. */
  financialsThrough: string | null;
  stance: ReportStance;
  thesis: string;
  drivers: Audited<Argument>[];
  risks: Audited<Argument>[];
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
  ClaimUnsupported: "claim-unsupported",
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
    }
  | {
      code: typeof ReportViolationCode.ClaimUnsupported;
      claim: string;
      /** How likely its quote states it, from 0 to 1. */
      supported: number;
    };

export type Revision =
  | { ok: true; report: Report }
  | { ok: false; violations: ReportViolation[] };

/** What the desk knows as a report is revised. */
export interface RevisionContext {
  /** Epoch ms. */
  at: number;
  /** The last day of the newest quarter public now; `null` when none is known. */
  financialsThrough: string | null;
  /** The reading each of the draft's claims was given; `null` for one that was not read. */
  support: (claim: Claim) => ClaimSupport | null;
}

/**
 * The revision `draft` makes of `previous`; a listing's first must give a stance and a thesis,
 * since nothing earlier holds them.
 */
export function reviseReport(
  previous: Report | null,
  draft: ReportDraft,
  { at, financialsThrough, support }: RevisionContext
): Revision {
  const audited = (claims: Argument[] | undefined) =>
    claims?.map((claim) => ({ ...claim, support: support(claim) }));

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

  for (const weak of unsupportedClaims(
    [...(draft.drivers ?? []), ...(draft.risks ?? [])],
    support
  )) {
    violations.push({ code: ReportViolationCode.ClaimUnsupported, ...weak });
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
      financialsThrough,
      stance,
      thesis,
      drivers: audited(draft.drivers) ?? previous?.drivers ?? [],
      risks: audited(draft.risks) ?? previous?.risks ?? [],
      falsifiers: draft.falsifiers ?? previous?.falsifiers ?? [],
      valuation,
      events: draft.events ?? previous?.events ?? [],
      sections,
    },
  };
}
