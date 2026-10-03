import { groupBy, mapAsync, sumBy } from "es-toolkit";

import { errorMessage } from "@solyx/utils/error";

import type { Listing } from "./market-data.ts";
import { exchangeDate } from "./market.ts";
import type { Market, SymbolRef } from "./market.ts";
import { TextKind, stanceValue } from "./sentiment.ts";
import type { SentimentScore, SentimentScorer } from "./sentiment.ts";

/** Where items were published, which decides whose voice they carry. */
export const NewsChannel = {
  /** Material information the company files with the exchange. */
  Announcement: "announcement",
  /** News outlets' articles. */
  Article: "article",
  /** Stock forums, such as PTT's Stock board. */
  Forum: "forum",
  /** Social networks, such as Threads and X. */
  Social: "social",
} as const;

export type NewsChannel = (typeof NewsChannel)[keyof typeof NewsChannel];

/** How exactly a source tells when an item was published. */
export const TimePrecision = {
  /** To the minute, such as a filing's time or a post id's. */
  Minute: "minute",
  /** To about an hour, such as a search engine's "3 hours ago". */
  Hour: "hour",
  /** Only the day, such as "2 days ago" or a date without a time. */
  Day: "day",
} as const;

export type TimePrecision = (typeof TimePrecision)[keyof typeof TimePrecision];

export interface Published {
  /** Exact only to its precision; a date given without a time is the start of that day on the exchange's calendar. */
  at: Date;
  precision: TimePrecision;
}

/** An announcement, article or post a news source found. */
export interface NewsItem {
  /** Identifies it within its source, such as its address, so finding it again recognizes it. */
  id: string;
  /** `null` when the source has no page for it. */
  url: string | null;
  title: string;
  /** What the source shows of it, such as a search snippet, rather than the whole text. */
  snippet: string;
  /** The host it was published on, without `www.`. */
  site: string;
  /** `null` when the source gives no time it can be read from. */
  published: Published | null;
  /** Net votes where the source counts them, such as PTT's pushes minus boos. */
  votes: number | null;
}

export interface NewsQuery {
  symbol: SymbolRef;
  /** The exchange's names for it, which articles use more often than the code. */
  listing: Listing | null;
  /** The earliest publication day to include. */
  since: Date;
  limit: number;
}

/** Finds items about a listing; one implementation per source (`@solyx/news/*`), main process only. */
export interface NewsSource {
  readonly id: string;
  readonly channel: NewsChannel;
  readonly markets: readonly Market[];
  search(query: NewsQuery): Promise<NewsItem[]>;
}

/** An item stored for a listing: where it came from and, once judged, the decisions model's reading. */
export interface NewsRecord {
  source: string;
  channel: NewsChannel;
  item: NewsItem;
  /** When a search first found it for the listing. */
  foundAt: Date;
  score: SentimentScore | null;
}

/** How a source's searches have gone, so a quiet listing can be told from a broken source. */
export interface SourceHealth {
  source: string;
  /** `null` before a search of it first works. */
  lastSuccessAt: Date | null;
  /** `null` before a search of it first fails. */
  lastFailureAt: Date | null;
  /** Searches that failed since the last that worked. */
  failureStreak: number;
  /** The latest failure's message. */
  lastError: string | null;
}

/** Keeps what sources found per listing, so history outlives each source's window. */
export interface NewsStore {
  /**
   * Stores what a source found for a listing. An item stored before keeps its score and the first
   * publication time it was given, and takes the latest title, snippet and votes.
   */
  save(
    symbol: SymbolRef,
    source: Pick<NewsSource, "id" | "channel">,
    items: readonly NewsItem[],
    foundAt: Date
  ): void;
  /** Stores the decisions model's reading of a record's item for the listing. */
  saveScore(symbol: SymbolRef, record: NewsRecord, score: SentimentScore): void;
  /** A listing's records published since `since`, or found since then when undated, newest first. */
  list(symbol: SymbolRef, since: Date): NewsRecord[];
  /** When news was last collected for a listing; `null` before the first time. */
  lastCollected(symbol: SymbolRef): Date | null;
  markCollected(symbol: SymbolRef, at: Date): void;
  /** Records how a search of a source went: the failure's message, or `null` when it worked. */
  markSearched(source: string, at: Date, error: string | null): void;
  /** Every source searched so far. */
  sourceHealth(): SourceHealth[];
}

export interface CollectNewsOptions {
  sources: readonly NewsSource[];
  store: NewsStore;
  /** `undefined` leaves records unscored. */
  scorer: SentimentScorer | undefined;
  query: NewsQuery;
  now: Date;
  /** Requests to the scorer at once. */
  concurrency: number;
}

/** Records of one channel that tell the same story, such as an article's reprints or a thread's replies. */
export interface NewsStory {
  channel: NewsChannel;
  /** The record it is shown and judged by: the earliest scored one, or else the earliest. */
  lead: NewsRecord;
  /** Every record that tells it, the lead among them, earliest first. */
  records: NewsRecord[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

// Replies and forwards repeat the title they answer, as PTT's `Re:` and `Fw:` do.
const REPLY_PREFIX = /^(?:(?:re|fw|fwd)\s*:\s*)+/i;

// A title shorter than this, such as a lone company name, says too little to tell items apart.
const STORY_TITLE_MIN = 8;

// Records whose titles match but lie further apart than this are separate stories.
const STORY_GAP_MS = 3 * DAY_MS;

/** Undated records count from when they were found. */
const datedAt = (record: NewsRecord) =>
  record.item.published?.at ?? record.foundAt;

/** The title's letters and digits without reply prefixes; `null` when too short to compare. */
function storyTitle(title: string): string | null {
  const letters = title
    .normalize("NFKC")
    .trim()
    .replace(REPLY_PREFIX, "")
    .replace(/[^\p{L}\p{N}]/gu, "")
    .toLowerCase();

  return letters.length >= STORY_TITLE_MIN ? letters : null;
}

/**
 * Groups the records of each channel whose titles read the same, newest story first, so a story
 * told many times is weighed once. Titles must match once reduced to letters and digits: nearly
 * equal headlines, such as one that raises a target and one that cuts it, can say opposite things.
 */
export function newsStories(records: readonly NewsRecord[]): NewsStory[] {
  const groups: NewsRecord[][] = [];
  const latest = new Map<string, NewsRecord[]>();

  for (const record of records.toSorted(
    (a, b) => datedAt(a).getTime() - datedAt(b).getTime()
  )) {
    const title = storyTitle(record.item.title);
    const key = title === null ? null : `${record.channel}:${title}`;
    const group = key === null ? undefined : latest.get(key);
    const last = group?.at(-1);

    if (
      group &&
      last &&
      datedAt(record).getTime() - datedAt(last).getTime() <= STORY_GAP_MS
    ) {
      group.push(record);
      continue;
    }

    groups.push([record]);

    if (key !== null) latest.set(key, groups[groups.length - 1]);
  }

  return groups
    .map((group) => ({
      channel: group[0].channel,
      lead: group.find((record) => record.score) ?? group[0],
      records: group,
    }))
    .toSorted((a, b) => datedAt(b.lead).getTime() - datedAt(a.lead).getTime());
}

export interface NewsCollection {
  /** Each channel's newest stories, up to the query's limit, newest first. */
  stories: NewsStory[];
  /** Sources whose search failed; what they stored before is still among `stories`. */
  failures: { source: string; error: unknown }[];
}

/**
 * Searches every source, stores what each finds and how each search went, then scores the lead
 * of each channel's newest stories that hold no score yet, so a story is judged once however
 * often and wherever it is found.
 */
export async function collectNews({
  sources,
  store,
  scorer,
  query,
  now,
  concurrency,
}: CollectNewsOptions): Promise<NewsCollection> {
  // One source failing leaves the others' items, and what it found before, in the collection.
  const results = await Promise.allSettled(
    sources.map((source) => source.search(query))
  );

  const failures: NewsCollection["failures"] = [];

  for (const [index, result] of results.entries()) {
    const source = sources[index];

    if (result.status === "fulfilled") {
      store.save(query.symbol, source, result.value, now);
      store.markSearched(source.id, now, null);
    } else {
      failures.push({ source: source.id, error: result.reason });
      store.markSearched(source.id, now, errorMessage(result.reason));
    }
  }

  // Marked even when a source failed, so a broken source is not searched again and again.
  store.markCollected(query.symbol, now);

  const newest = Object.values(
    groupBy(
      newsStories(store.list(query.symbol, query.since)),
      (story) => story.channel
    )
  ).flatMap((stories) => stories.slice(0, query.limit));

  if (!scorer) return { stories: newest, failures };

  const stories = await mapAsync(
    newest,
    async (story) => {
      const { lead } = story;

      if (lead.score) return story;

      const score = await scorer.score({
        symbol: query.symbol,
        listing: query.listing,
        title: lead.item.title,
        text: lead.item.snippet,
      });

      store.saveScore(query.symbol, lead, score);

      const scored = { ...lead, score };

      return {
        ...story,
        lead: scored,
        records: story.records.map((record) =>
          record === lead ? scored : record
        ),
      };
    },
    { concurrency }
  );

  return { stories, failures };
}

/** Below this relevance an item only names the listing in passing. */
export const RELEVANCE_FLOOR = 0.5;

/** Whose voice a channel carries. */
export const NewsVoice = {
  /** Companies and news outlets: announcements and articles. */
  Press: "press",
  /** Investors themselves: forum and social posts. */
  Crowd: "crowd",
} as const;

export type NewsVoice = (typeof NewsVoice)[keyof typeof NewsVoice];

export const CHANNEL_VOICE: Record<NewsChannel, NewsVoice> = {
  [NewsChannel.Announcement]: NewsVoice.Press,
  [NewsChannel.Article]: NewsVoice.Press,
  [NewsChannel.Forum]: NewsVoice.Crowd,
  [NewsChannel.Social]: NewsVoice.Crowd,
};

/** Whether a story is about the listing: its lead scored above the relevance floor, or not scored yet. */
export function isAboutListing({ lead: { score } }: NewsStory): boolean {
  return !score || score.relevance >= RELEVANCE_FLOOR;
}

/** A stance from −1 to 1 on the gauge's scale, 0 to 100 with 50 neutral. */
const gaugeScore = (stance: number) => Math.round((stance + 1) * 50);

/** How a story reads on the gauge's scale; `null` until it is scored. */
export function storyScore({ lead: { score } }: NewsStory): number | null {
  return score ? gaugeScore(stanceValue(score.stance)) : null;
}

interface Weighed {
  /** From −1 to 1; `null` when none of the stories is scored. */
  stance: number | null;
  weight: number;
  stories: number;
}

/**
 * The stories' stance, each scored one weighed by how surely it is about the listing and is not
 * a promotion. Expects stories about the listing only.
 */
function weigh(stories: readonly NewsStory[]): Weighed {
  const weighed = stories.flatMap(({ lead: { score } }) =>
    score
      ? [
          {
            stance: stanceValue(score.stance),
            weight: score.relevance * (1 - score.kind[TextKind.Promotion]),
          },
        ]
      : []
  );

  const weight = sumBy(weighed, (entry) => entry.weight);

  return {
    stance:
      weight > 0
        ? sumBy(weighed, (entry) => entry.stance * entry.weight) / weight
        : null,
    weight,
    stories: stories.length,
  };
}

/** One exchange-local day of what was said about a listing. */
export interface SentimentDay {
  /** `YYYY-MM-DD` on the exchange's calendar. */
  date: string;
  /** From −1 to 1; `null` when none of the day's stories is scored. */
  stance: number | null;
  /** The sum of the stories' weights, so days can be merged into longer periods. */
  weight: number;
  /** Stories about the listing, scored or not. */
  stories: number;
}

/**
 * Each day with stories about the listing, oldest first, by when each story's lead was published,
 * or found when undated.
 */
export function dailySentiment(
  market: Market,
  records: readonly NewsRecord[]
): SentimentDay[] {
  const days = groupBy(newsStories(records).filter(isAboutListing), (story) =>
    exchangeDate(market, datedAt(story.lead))
  );

  return Object.entries(days)
    .map(([date, dayStories]) => ({ date, ...weigh(dayStories) }))
    .toSorted((a, b) => a.date.localeCompare(b.date));
}

export interface SentimentReading {
  /** 0 to 100 with 50 neutral, from the weighted stance; `null` when nothing is scored. */
  score: number | null;
  /** Stories about the listing, scored or not. */
  stories: number;
}

export interface SentimentGauge {
  overall: SentimentReading;
  voices: Record<NewsVoice, SentimentReading>;
}

function reading(stories: readonly NewsStory[]): SentimentReading {
  const { stance, stories: count } = weigh(stories);

  return {
    score: stance === null ? null : gaugeScore(stance),
    stories: count,
  };
}

/** How the stories about a listing read on a 0-to-100 scale, overall and in each voice. */
export function sentimentGauge(records: readonly NewsRecord[]): SentimentGauge {
  const about = newsStories(records).filter(isAboutListing);

  return {
    overall: reading(about),
    voices: {
      [NewsVoice.Press]: reading(
        about.filter(
          ({ channel }) => CHANNEL_VOICE[channel] === NewsVoice.Press
        )
      ),
      [NewsVoice.Crowd]: reading(
        about.filter(
          ({ channel }) => CHANNEL_VOICE[channel] === NewsVoice.Crowd
        )
      ),
    },
  };
}
