import * as z from "zod";

/** The vendors the app searches and reads the web through, one module each. */
export const WebSearchProvider = {
  Firecrawl: "firecrawl",
  Exa: "exa",
  Tavily: "tavily",
} as const;

export type WebSearchProvider =
  (typeof WebSearchProvider)[keyof typeof WebSearchProvider];

export const webSearchProviderSchema = z.enum(WebSearchProvider);
