import * as z from "zod";

import type { VectorCache } from "./embedding.ts";
import type { SymbolRef } from "./market.ts";

/** What a memory holds, which decides where the agent's index lists it. */
export const MemoryKind = {
  /** Who the user is: goals, experience, risk budget and constraints. */
  Profile: "profile",
  /** How the user wants the agent to work: corrections, and approaches they confirmed. */
  Feedback: "feedback",
  /** A fact or thesis worth carrying to later conversations, true as of when it was written. */
  Note: "note",
} as const;

export type MemoryKind = (typeof MemoryKind)[keyof typeof MemoryKind];

export const memoryKindSchema = z.enum(MemoryKind);

export const MEMORY_DESCRIPTION_LENGTH = 150;

export const MEMORY_BODY_LENGTH = 2_000;

// Formats whose every match is a credential or an ID number rather than prose.
const SECRET_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\b(?:sk|rk)-[\w-]{20,}/,
  /\bgh[opsur]_[A-Za-z0-9]{30,}/,
  /\bgithub_pat_\w{30,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bAIza[\w-]{35}\b/,
  /\bxox[abprs]-[\w-]{10,}/,
  // A JSON Web Token.
  /\beyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]{10,}/,
  // A Taiwan national ID or resident certificate number.
  /\b[A-Z][1289]\d{8}\b/,
];

/** Whether `text` holds what looks like a key, token, private key or Taiwan ID number. */
export function holdsSecret(text: string): boolean {
  return SECRET_PATTERNS.some((pattern) => pattern.test(text));
}

const SECRET_MESSAGE =
  "A memory never holds a key, token, password or ID number";

/** One line the index shows: what the memory holds and when it matters. */
export const memoryDescriptionSchema = z
  .string()
  .trim()
  .min(1)
  .max(MEMORY_DESCRIPTION_LENGTH)
  .refine((text) => !holdsSecret(text), SECRET_MESSAGE);

/** What the agent reads once the description says the memory applies; may be empty. */
export const memoryBodySchema = z
  .string()
  .trim()
  .max(MEMORY_BODY_LENGTH)
  .refine((text) => !holdsSecret(text), SECRET_MESSAGE);

/** What the user may rewrite of a memory. */
export const memoryChangeSchema = z.object({
  description: memoryDescriptionSchema,
  body: memoryBodySchema,
});

export type MemoryChange = z.infer<typeof memoryChangeSchema>;

/** What the agent keeps across conversations, each saved once the user allowed it. */
export interface Memory {
  id: string;
  kind: MemoryKind;
  /** The listing it is about, if one. */
  listing: SymbolRef | null;
  description: string;
  body: string;
  /** Epoch ms. */
  createdAt: number;
  /** Epoch ms. */
  updatedAt: number;
  /** The conversation that last wrote it; kept after that conversation is deleted. */
  source: string | null;
}

export type MemoryDraft = Omit<Memory, "createdAt" | "updatedAt">;

/** Where memories persist across conversations, and the vectors of what they hold. */
export interface MemoryStore extends VectorCache {
  /** Most recently updated first. */
  list(): Memory[];
  /** The memories with these ids, in the order asked; an id no memory has is left out. */
  read(ids: readonly string[]): Memory[];
  /** Up to `limit` memories matching any word of `query`, best first. */
  search(query: string, limit: number): Memory[];
  /**
   * Saves a memory at `at`, replacing the one with its id but keeping when that was created, so
   * saving the same draft again changes nothing but `updatedAt`.
   */
  save(draft: MemoryDraft, at: number): Memory;
  /** Whether a memory had the id. */
  forget(id: string): boolean;
}

/** What a memory's vector is made of: its description and body. */
export function memoryText({
  description,
  body,
}: Pick<Memory, "description" | "body">): string {
  return body ? `${description}\n${body}` : description;
}

/**
 * By space, the line above which a new memory reads as one of the same kind and listing said again.
 * Each rests on `eval-memories` in `@solyx/embeddings`; a space not listed flags none.
 */
export const MEMORY_LINES = new Map<string, number>([
  ["qwen3-embedding:0.6b", 0.72],
]);
