import * as z from "zod";

import type { NewsChannel, NewsVoice, SourceHealth } from "@solyx/core/news";

/**
 * How long the app keeps what news sources found, from when it came out, or was found when
 * undated. The shortest is as far back as the agent reads a listing's news.
 */
export const NewsRetention = {
  Month: "30d",
  Quarter: "90d",
  HalfYear: "180d",
  Year: "365d",
  Forever: "forever",
} as const;

export type NewsRetention = (typeof NewsRetention)[keyof typeof NewsRetention];

export const newsRetentionSchema = z.enum(NewsRetention);

/** The days each retention keeps; `null` keeps everything. */
export const RETENTION_DAYS: Record<NewsRetention, number | null> = {
  [NewsRetention.Month]: 30,
  [NewsRetention.Quarter]: 90,
  [NewsRetention.HalfYear]: 180,
  [NewsRetention.Year]: 365,
  [NewsRetention.Forever]: null,
};

/** How long the news of each channel's voice is kept, as the user set it. */
export type NewsRetentionSettings = Record<NewsVoice, NewsRetention>;

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
