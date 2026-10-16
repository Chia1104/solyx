import { NewsVoice } from "@solyx/core/news";
import type { NewsChannel, SourceHealth } from "@solyx/core/news";

/**
 * How many days the app keeps what a source found, by its channel's voice, from when it came out,
 * or was found when undated. Nothing reads news this old but a search of what was kept, and
 * investors' posts stop bearing on a listing first.
 */
export const NEWS_KEPT_DAYS: Record<NewsVoice, number> = {
  [NewsVoice.Press]: 90,
  [NewsVoice.Crowd]: 30,
};

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
