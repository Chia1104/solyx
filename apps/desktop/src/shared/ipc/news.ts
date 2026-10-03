import type { SymbolRef } from "@solyx/core/market";
import type { NewsChannel, NewsRecord, SourceHealth } from "@solyx/core/news";

/** A source a listing's news is searched in, and how its searches have gone. */
export interface NewsSourceStatus {
  id: string;
  channel: NewsChannel;
  /** `null` before it is first searched. */
  health: SourceHealth | null;
}

export interface NewsCoverage {
  /** When news was last collected for the listing; `null` before the first time. */
  collectedAt: Date | null;
  /** The sources that cover the listing's market, the company's own word first. */
  sources: NewsSourceStatus[];
}

export interface NewsApi {
  /** What was collected about a listing over the last `days` days, newest first. */
  records(symbol: SymbolRef, days: number): Promise<NewsRecord[]>;
  /** Where a listing's news comes from, so a quiet listing can be told from a broken source. */
  coverage(symbol: SymbolRef): Promise<NewsCoverage>;
}

/** Pushes from the main process; each subscription returns a function that stops listening. */
export interface NewsEvents {
  /** The listing's news was collected, or some of it scored; source health may have changed with it. */
  onChanged(listener: (symbol: SymbolRef) => void): () => void;
}

export const newsChannels = {
  records: "news:records",
  coverage: "news:coverage",
} as const satisfies Record<keyof NewsApi, string>;

export const newsEvents = {
  onChanged: "news:changed",
} as const satisfies Record<keyof NewsEvents, string>;
