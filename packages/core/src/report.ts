import * as z from "zod";

import { sentences } from "@solyx/utils/search";

import { EventTiming } from "./calendar.ts";
import { Market, symbolRefSchema } from "./market.ts";
import type { SymbolRef } from "./market.ts";
import { holdsSecret } from "./memory.ts";
import { twRocDate } from "./rules/tw.ts";

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

/** A claim or an event as kept, with the reading its fact was given; `null` when no decisions model read it. */
export type Audited<Kept extends Claim | ReportEvent> = Kept & {
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

/** A date ahead that could move the shares, with the source's own words for it. */
export const reportEventSchema = z.object({
  /** Exchange-local date, `YYYY-MM-DD`. */
  date: z.iso.date(),
  /** What happens, saying no more than its quote does. */
  label: proseSchema(100),
  timing: z.enum(EventTiming),
  /** Where the date comes from: a page's address, or a name such as a filing's. */
  source: proseSchema(300),
  /** The source's own words that give the date. */
  quote: proseSchema(1_200),
});

export type ReportEvent = z.infer<typeof reportEventSchema>;

const TIMING_WORDS: Record<EventTiming, string> = {
  [EventTiming.Set]: "on",
  [EventTiming.Deadline]: "by",
  [EventTiming.Expected]: "expected around",
};

/** The day an event's claim names, in the form a quote most likely gives it. */
function claimedDay(date: string, timing: EventTiming, market: Market) {
  // A source that only expects a day seldom gives its year.
  if (timing === EventTiming.Expected) {
    const { month, day } = Temporal.PlainDate.from(date);

    return `${month}/${day}`;
  }

  // Taiwan's filings date by the Republic of China calendar, and a model reads `115 年` against
  // `2026` poorly: it takes another year's same day for it.
  return market === Market.TW ? `${date} (${twRocDate(date)})` : date;
}

/**
 * What an event asserts, as a claim its quote is read against. `eval-claims` in `@solyx/decisions`
 * measures how it words the day: measure again after changing it.
 */
export function eventClaim(
  { date, label, timing, source, quote }: ReportEvent,
  market: Market
): Claim {
  return {
    text: `${label}, ${TIMING_WORDS[timing]} ${claimedDay(date, timing, market)}`,
    source,
    quote,
  };
}

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
  /** Dates ahead that could move the shares and that no filing sets, such as an earnings call or a ruling. */
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
  /** As they were written: one whose day has passed stays until a revision says what came of it. */
  events: Audited<ReportEvent>[];
  /** Each part with when it was last written, in epoch ms, which tells how old it is. */
  sections: Partial<Record<ReportSection, { text: string; revisedAt: number }>>;
}

export const ReportViolationCode = {
  MissingStance: "missing-stance",
  MissingThesis: "missing-thesis",
  ValuationInverted: "valuation-inverted",
  ClaimUnsupported: "claim-unsupported",
  EventPassed: "event-passed",
  EventUnsupported: "event-unsupported",
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
    }
  | {
      code: typeof ReportViolationCode.EventPassed;
      date: string;
      label: string;
    }
  | {
      code: typeof ReportViolationCode.EventUnsupported;
      date: string;
      label: string;
      /** How likely its quote gives that day for it, from 0 to 1. */
      supported: number;
    };

export type Revision =
  | { ok: true; report: Report }
  | { ok: false; violations: ReportViolation[] };

/** What the desk knows as a report is revised. */
export interface RevisionContext {
  /** Epoch ms. */
  at: number;
  /** The day on the listing's exchange, `YYYY-MM-DD`. */
  today: string;
  /** The last day of the newest quarter public now; `null` when none is known. */
  financialsThrough: string | null;
  /** The reading each of the draft's claims was given, its events' among them; `null` for one that was not read. */
  support: (claim: Claim) => ClaimSupport | null;
}

/**
 * The revision `draft` makes of `previous`; a listing's first must give a stance and a thesis,
 * since nothing earlier holds them. An event the draft names must still lie ahead, while one
 * carried over from `previous` stays though its day has passed.
 */
export function reviseReport(
  previous: Report | null,
  draft: ReportDraft,
  { at, today, financialsThrough, support }: RevisionContext
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

  const { market } = draft.symbol;

  for (const event of draft.events ?? []) {
    const { date, label } = event;
    const reading = support(eventClaim(event, market));

    if (date < today) {
      violations.push({ code: ReportViolationCode.EventPassed, date, label });
    }

    if (reading && reading.supported < CLAIM_SUPPORT_LINE) {
      violations.push({
        code: ReportViolationCode.EventUnsupported,
        date,
        label,
        supported: reading.supported,
      });
    }
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
      events:
        draft.events?.map((event) => ({
          ...event,
          support: support(eventClaim(event, market)),
        })) ??
        previous?.events ??
        [],
      sections,
    },
  };
}

/**
 * The report's events whose day is behind `today`, an exchange-local day: no longer ahead, so the
 * report owes what came of each.
 */
export function passedEvents(
  { events }: Pick<Report, "events">,
  today: string
): Audited<ReportEvent>[] {
  return events.filter(({ date }) => date < today);
}

/**
 * The parts of a report a search reads one by one, each labelled with where it stands: every
 * driver and risk, falsifier, valuation, event and sentence of its prose. The thesis stands apart.
 */
export function reportPassages(report: Report): string[] {
  return [
    ...report.drivers.map(
      (driver) => `driver: ${driver.point} Rests on: ${driver.text}`
    ),
    ...report.risks.map((risk) => `risk: ${risk.point} Rests on: ${risk.text}`),
    ...report.falsifiers.map((falsifier) => `falsifier: ${falsifier}`),
    ...(report.valuation
      ? [
          `valuation: ${report.valuation.low} to ${report.valuation.high} (${report.valuation.basis})`,
        ]
      : []),
    ...report.events.map((event) => `event: ${event.date} ${event.label}`),
    ...Object.entries(report.sections).flatMap(([section, part]) =>
      sentences(part.text).map((sentence) => `${section}: ${sentence}`)
    ),
  ];
}
