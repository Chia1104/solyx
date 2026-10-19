import * as z from "zod";

/** What the pane under a listing's chart shows, kept in the URL so a link can open the research. */
export const LowerView = {
  News: "news",
  Research: "research",
  Flows: "flows",
  Orders: "orders",
} as const;

export type LowerView = (typeof LowerView)[keyof typeof LowerView];

export const lowerViewSchema = z.enum(LowerView);
