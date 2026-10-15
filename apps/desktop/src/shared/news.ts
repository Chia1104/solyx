import type { NewsChannel, SourceHealth } from "@solyx/core/news";

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
