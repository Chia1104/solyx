import type { Listing } from "./market-data.ts";
import type { SymbolRef } from "./market.ts";

/** How a text bears on a listing's share price, in order from clearly bad to clearly good. */
export const Stance = {
  Negative: "negative",
  LeanNegative: "lean-negative",
  Neutral: "neutral",
  LeanPositive: "lean-positive",
  Positive: "positive",
} as const;

export type Stance = (typeof Stance)[keyof typeof Stance];

/** What a text is, which decides whose view its stance stands for. */
export const TextKind = {
  /** Facts or announcements without a view of its own: news reports, press releases, filings. */
  Report: "report",
  /** A person's own view, analysis or reaction. */
  Opinion: "opinion",
  /** Pushes readers to buy or sell: paid signals, stock-tip groups, advertising. */
  Promotion: "promotion",
} as const;

export type TextKind = (typeof TextKind)[keyof typeof TextKind];

/** What a text is mainly about, as far as the listing goes. */
export const TextTopic = {
  Earnings: "earnings",
  Guidance: "guidance",
  Business: "business",
  Capital: "capital",
  Analyst: "analyst",
  Legal: "legal",
  Market: "market",
  Other: "other",
} as const;

export type TextTopic = (typeof TextTopic)[keyof typeof TextTopic];

/** A text and the listing it is judged about. */
export interface SentimentInput {
  symbol: SymbolRef;
  /** The exchange's names for it, which a text may use instead of the code. */
  listing: Listing | null;
  title?: string;
  text: string;
}

/** Probabilities; each record sums to one across its options. */
export interface SentimentScore {
  /** The model that answered, as its provider names the version. */
  model: string;
  /** That the text is about the listing rather than naming it in passing. */
  relevance: number;
  stance: Record<Stance, number>;
  kind: Record<TextKind, number>;
  topic: Record<TextTopic, number>;
}

/**
 * Judges what a text says about a listing. One implementation per decisions model
 * (`@solyx/decisions/*`); it runs only in the main process.
 */
export interface SentimentScorer {
  score(
    input: SentimentInput,
    options?: { signal?: AbortSignal }
  ): Promise<SentimentScore>;
}
